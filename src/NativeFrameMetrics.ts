import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type NativeSample = {
  frameCount: number;
  droppedFrames: number;
  durationMs: number;
  uiStallMs: number;
  jsStallMs: number;
  frameBudgetMs: number;
};

export interface Spec extends TurboModule {
  start(): void;
  stop(): void;
  getMetrics(): Promise<NativeSample>;
}

export default TurboModuleRegistry.get<Spec>('FrameMetrics');
