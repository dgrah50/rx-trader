export interface Clock {
  now: () => number;
}

interface ManualClock extends Clock {
  advance: (delta: number) => number;
  set: (value: number) => number;
}

export const systemClock: Clock = {
  now: () => Date.now()
};

export const createManualClock = (start: number = Date.now()): ManualClock => {
  let current = start;
  return {
    now: () => current,
    advance: (delta: number) => {
      current += delta;
      return current;
    },
    set: (value: number) => {
      current = value;
      return current;
    }
  };
};
