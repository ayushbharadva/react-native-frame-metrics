#import "FrameMetrics.h"
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <memory>
#include <mutex>
#include <time.h>

static const double kDefaultBudgetMs = 1000.0 / 60.0;
// Mirrors FrameWindow.kt: vsync-aligned drops land on whole budget multiples, while a
// display changing rate leaves 1.5x-1.8x intervals, so drops count from 1.85x. For three
// frames after a rate change, one extra slow frame is allowed while the display switches.
static const double kDropTolerance = 0.15;
static const double kBudgetChangeMs = 0.1;
static const int kSettlingFrames = 3;
static const int64_t kProbeIntervalNs = 16 * NSEC_PER_MSEC;

@class FrameMetrics;
@interface FMDisplayLinkTarget : NSObject
@property (nonatomic, weak) FrameMetrics *owner;
- (void)tick:(CADisplayLink *)link;
@end

@interface FrameMetrics ()
- (void)onFrame:(CADisplayLink *)link;
@end

@implementation FMDisplayLinkTarget
- (void)tick:(CADisplayLink *)link { [self.owner onFrame:link]; }
@end

@implementation FrameMetrics {
  // Main thread only.
  CADisplayLink *_link;
  BOOL _requested;
  BOOL _invalidated;
  CFTimeInterval _previous;
  double _previousBudgetMs;
  int _settlingFrames;
  double _frames;
  double _drops;
  double _durationMs;
  double _uiStallMs;
  // Written on the main thread, read by the probe queue.
  std::atomic<double> _budgetMs;
  // Probe queue only, apart from the mutex-guarded total.
  dispatch_queue_t _probeQueue;
  std::weak_ptr<facebook::react::CallInvoker> _jsInvoker;
  uint64_t _probeGeneration;
  std::mutex _jsMutex;
  double _jsStallMs;
}

- (instancetype)init {
  if ((self = [super init])) {
    _budgetMs.store(kDefaultBudgetMs);
    _probeQueue = dispatch_queue_create("com.framemetrics.js-probe", DISPATCH_QUEUE_SERIAL);
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(didBecomeActive:)
                   name:UIApplicationDidBecomeActiveNotification object:nil];
    [center addObserver:self selector:@selector(willResignActive:)
                   name:UIApplicationWillResignActiveNotification object:nil];
  }
  return self;
}

- (void)reset {
  _previous = 0;
  _previousBudgetMs = 0;
  _settlingFrames = 0;
  _frames = 0;
  _drops = 0;
  _durationMs = 0;
  _uiStallMs = 0;
  std::lock_guard<std::mutex> lock(_jsMutex);
  _jsStallMs = 0;
}

- (void)resumeSampling {
  if (_link || !_requested || _invalidated ||
      UIApplication.sharedApplication.applicationState != UIApplicationStateActive) return;
  [self reset];
  FMDisplayLinkTarget *target = [FMDisplayLinkTarget new];
  target.owner = self;
  _link = [CADisplayLink displayLinkWithTarget:target selector:@selector(tick:)];
  // Zero asks for the display's default maximum cadence, including ProMotion.
  _link.preferredFramesPerSecond = 0;
  [_link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  [self startProbe];
}

- (void)pauseSampling {
  [_link invalidate];
  _link = nil;
  [self stopProbe];
  [self reset];
}

- (void)start {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) return;
    self->_requested = YES;
    [self resumeSampling];
  });
}

- (void)stop {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_requested = NO;
    [self pauseSampling];
  });
}

- (void)didBecomeActive:(NSNotification *)notification { [self resumeSampling]; }
- (void)willResignActive:(NSNotification *)notification { [self pauseSampling]; }

- (void)onFrame:(CADisplayLink *)link {
  double budget = (link.targetTimestamp - link.timestamp) * 1000.0;
  if (!std::isfinite(budget) || budget <= 0) budget = kDefaultBudgetMs;
  if (_previous > 0 && link.timestamp <= _previous) return;
  if (_previousBudgetMs > 0 && std::abs(budget - _previousBudgetMs) > kBudgetChangeMs) {
    _settlingFrames = kSettlingFrames;
  }
  if (_previous > 0) {
    const double deltaMs = (link.timestamp - _previous) * 1000.0;
    // Judge an interval that spans a rate change against the slower rate.
    const double intervalBudget = std::max(_previousBudgetMs, budget);
    const double allowedFrames = _settlingFrames > 0 ? 2.0 : 1.0;
    const double dropped =
        std::max(0.0, std::floor(deltaMs / intervalBudget + kDropTolerance) - allowedFrames);
    _frames += 1;
    _durationMs += deltaMs;
    if (dropped > 0) {
      _drops += dropped;
      _uiStallMs += deltaMs - intervalBudget * allowedFrames;
    }
  }
  if (_settlingFrames > 0) _settlingFrames -= 1;
  _previous = link.timestamp;
  _previousBudgetMs = budget;
  _budgetMs.store(budget);
}

#pragma mark - JS thread probe

// Posts a no-op to the JS thread and times the wait, one probe at a time. JS timers and
// requestAnimationFrame depend on the main thread, so they cannot separate the two threads.

- (void)startProbe {
  dispatch_async(_probeQueue, ^{
    self->_probeGeneration += 1;
    [self sendProbe:self->_probeGeneration];
  });
}

- (void)stopProbe {
  dispatch_async(_probeQueue, ^{
    self->_probeGeneration += 1;
  });
}

- (void)sendProbe:(uint64_t)generation {
  if (generation != _probeGeneration) return;
  std::shared_ptr<facebook::react::CallInvoker> invoker = _jsInvoker.lock();
  if (!invoker) return;
  const uint64_t sentAt = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
  __weak FrameMetrics *weakSelf = self;
  dispatch_queue_t queue = _probeQueue;
  invoker->invokeAsync([weakSelf, queue, generation, sentAt](facebook::jsi::Runtime &) {
    const uint64_t ranAt = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
    dispatch_async(queue, ^{
      [weakSelf finishProbe:generation latencyNs:ranAt - sentAt];
    });
  });
}

- (void)finishProbe:(uint64_t)generation latencyNs:(uint64_t)latencyNs {
  if (generation != _probeGeneration) return;
  const double overMs = latencyNs / 1e6 - _budgetMs.load();
  if (overMs > 0) {
    std::lock_guard<std::mutex> lock(_jsMutex);
    _jsStallMs += overMs;
  }
  const int64_t delayNs = std::max<int64_t>(0, kProbeIntervalNs - (int64_t)latencyNs);
  __weak FrameMetrics *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delayNs), _probeQueue, ^{
    [weakSelf sendProbe:generation];
  });
}

#pragma mark - TurboModule

- (void)getMetrics:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) {
      reject(@"E_INVALIDATED", @"FrameMetrics has been invalidated", nil);
      return;
    }
    double jsStallMs;
    {
      std::lock_guard<std::mutex> lock(self->_jsMutex);
      jsStallMs = self->_jsStallMs;
      self->_jsStallMs = 0;
    }
    NSDictionary *sample = @{
      @"frameCount": @(self->_frames),
      @"droppedFrames": @(self->_drops),
      @"durationMs": @(self->_durationMs),
      @"uiStallMs": @(self->_uiStallMs),
      @"jsStallMs": @(jsStallMs),
      @"frameBudgetMs": @(self->_budgetMs.load())
    };
    self->_frames = 0;
    self->_drops = 0;
    self->_durationMs = 0;
    self->_uiStallMs = 0;
    resolve(sample);
  });
}

- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_invalidated = YES;
    self->_requested = NO;
    [self pauseSampling];
    [NSNotificationCenter.defaultCenter removeObserver:self];
  });
}

- (void)dealloc {
  [_link invalidate];
  [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  _jsInvoker = params.jsInvoker;
  return std::make_shared<facebook::react::NativeFrameMetricsSpecJSI>(params);
}

+ (NSString *)moduleName { return @"FrameMetrics"; }
@end
