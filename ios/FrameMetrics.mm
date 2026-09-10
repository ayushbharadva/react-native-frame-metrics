#import "FrameMetrics.h"
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#include <cmath>

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
  CADisplayLink *_link;
  BOOL _requested;
  BOOL _invalidated;
  CFTimeInterval _previous;
  double _frames;
  double _drops;
  double _durationMs;
  double _budgetMs;
}

- (instancetype)init {
  if ((self = [super init])) {
    _budgetMs = 1000.0 / 60.0;
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
  _frames = 0;
  _drops = 0;
  _durationMs = 0;
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
}

- (void)pauseSampling {
  [_link invalidate];
  _link = nil;
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
  const double nextBudget = (link.targetTimestamp - link.timestamp) * 1000.0;
  if (std::isfinite(nextBudget) && nextBudget > 0) {
    if (std::abs(nextBudget - _budgetMs) > 0.1) [self reset];
    _budgetMs = nextBudget;
  }
  if (_previous > 0 && link.timestamp > _previous) {
    const double delta = (link.timestamp - _previous) * 1000.0;
    _frames += 1;
    _durationMs += delta;
    _drops += std::fmax(0.0, std::round(delta / _budgetMs) - 1.0);
  }
  _previous = link.timestamp;
}

- (void)getMetrics:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) {
      reject(@"E_INVALIDATED", @"FrameMetrics has been invalidated", nil);
      return;
    }
    NSDictionary *sample = @{
      @"frameCount": @(self->_frames),
      @"droppedFrames": @(self->_drops),
      @"durationMs": @(self->_durationMs),
      @"frameBudgetMs": @(self->_budgetMs)
    };
    self->_frames = 0;
    self->_drops = 0;
    self->_durationMs = 0;
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
  return std::make_shared<facebook::react::NativeFrameMetricsSpecJSI>(params);
}

+ (NSString *)moduleName { return @"FrameMetrics"; }
@end
