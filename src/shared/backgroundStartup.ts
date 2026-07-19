export interface BackgroundStartupSteps {
  registerListeners: () => void;
  startSettings: () => void;
  startFilterEngine: () => void;
  initializeBadge: () => void;
}

export function startBackgroundRuntime(steps: BackgroundStartupSteps): void {
  steps.registerListeners();
  steps.startSettings();
  steps.startFilterEngine();
  steps.initializeBadge();
}
