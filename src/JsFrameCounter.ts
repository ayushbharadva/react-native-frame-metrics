/** Counts JS callbacks using execution time, not the supplied vsync timestamp. */
export class JsFrameCounter {
  private previous: number | undefined;
  private frames = 0;
  private durationMs = 0;

  record(now: number) {
    if (this.previous !== undefined && now > this.previous) {
      this.frames += 1;
      this.durationMs += now - this.previous;
    }
    this.previous = now;
  }

  sample() {
    const fps =
      this.durationMs > 0 ? (this.frames * 1000) / this.durationMs : 0;
    this.frames = 0;
    this.durationMs = 0;
    return fps;
  }

  reset() {
    this.previous = undefined;
    this.frames = 0;
    this.durationMs = 0;
  }
}
