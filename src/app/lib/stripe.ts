import Stripe from "stripe";
import config from "../config";

// Stripe SDK client (Prisma Press pattern, test mode). Lazily constructed so
// the server still boots when STRIPE_SECRET_KEY is absent - the stripe
// adapter simply reports disabled and GET /payment/gateways omits it.
let stripeClient: Stripe | null = null;

export const getStripe = (): Stripe => {
	if (!stripeClient) {
		stripeClient = new Stripe(config.stripe_secret_key!);
	}

	return stripeClient;
};
