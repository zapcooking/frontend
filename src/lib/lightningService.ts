/**
 * Lightning Service - Handles external wallet payments via Bitcoin Connect
 * Uses Alby's launchPaymentModal for QR code display and wallet connection
 */

class LightningService {
  private static instance: LightningService;
  private initialized = false;

  constructor() {
    if (!LightningService.instance) {
      LightningService.instance = this;
    }
    return LightningService.instance;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import to avoid SSR issues
    const { init } = await import('@getalby/bitcoin-connect');
    init({
      appName: 'zap.cooking',
      showBalance: false
    });
    this.initialized = true;
  }

  async launchPayment(params: {
    invoice: string;
    verify?: string;
    onPaid: (response: { preimage: string }) => void;
    onCancelled: () => void;
  }): Promise<{ setPaid: (response: { preimage: string }) => void }> {
    const { invoice, verify, onPaid, onCancelled } = params;

    await this.init();

    let checkPaymentInterval: ReturnType<typeof setInterval> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let setPaid: (response: { preimage: string }) => void;

    // Start verify URL polling if available
    if (verify) {
      const { Invoice } = await import('@getalby/lightning-tools');

      checkPaymentInterval = setInterval(async () => {
        try {
          const inv = new Invoice({ pr: invoice, verify });
          const paid = await inv.verifyPayment();
          if (paid && inv.preimage) {
            // Trigger the modal's success state
            setPaid({ preimage: inv.preimage });
          }
        } catch (e) {
          // Silently retry - network errors are expected
        }
      }, 1000);

      // Stop polling after 5 minutes
      timeoutId = setTimeout(() => {
        if (checkPaymentInterval) clearInterval(checkPaymentInterval);
      }, 300000);
    }

    // Launch the unified payment modal
    const { launchPaymentModal } = await import('@getalby/bitcoin-connect');
    const result = launchPaymentModal({
      invoice,
      onPaid: (response) => {
        if (checkPaymentInterval) clearInterval(checkPaymentInterval);
        if (timeoutId) clearTimeout(timeoutId);
        onPaid(response);
      },
      onCancelled: () => {
        if (checkPaymentInterval) clearInterval(checkPaymentInterval);
        if (timeoutId) clearTimeout(timeoutId);
        onCancelled();
      }
    });

    setPaid = result.setPaid;

    return { setPaid };
  }
}

export const lightningService = new LightningService();
