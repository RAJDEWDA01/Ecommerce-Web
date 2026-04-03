declare global {
  interface Window {
    Razorpay?: new (options: unknown) => {
      open: () => void;
      on: (event: 'payment.failed', handler: (response: unknown) => void) => void;
    };
  }
}

export {};
