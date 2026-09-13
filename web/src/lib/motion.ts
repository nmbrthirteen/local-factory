export const easeOut = 'cubic-bezier(0.23,1,0.32,1)';

export const fadeUp = (durationMs: number) => ({ animation: `fade-up ${durationMs}ms ${easeOut} both` });

export const popIn = (durationMs: number, transformOrigin?: string) => ({ animation: `pop-in ${durationMs}ms ${easeOut} both`, transformOrigin });
