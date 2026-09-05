import httpStatus from "http-status";
import type { PaymentGateway } from "../../../generated/prisma/enums";
import config from "../../config";
import { AppError } from "../../utils/AppError";
import type { PaymentGatewayAdapter } from "./types";
import { bkashAdapter } from "./adapters/bkash";
import { sslcommerzAdapter } from "./adapters/sslcommerz";

// Gateway registry (master plan §2.1): adapters register themselves; the
// registry resolves by gateway value and reports which gateways have their
// credentials configured (env-driven, powers GET /payment/gateways).

const adapters: PaymentGatewayAdapter[] = [bkashAdapter, sslcommerzAdapter];

const byGateway = new Map<PaymentGateway, PaymentGatewayAdapter>(
	adapters.map((adapter) => [adapter.gateway, adapter]),
);

export const listEnabledGateways = (): string[] => {
	return adapters
		.filter((adapter) => adapter.isEnabled())
		.map((adapter) => adapter.gateway.toLowerCase());
};

export const getAdapter = (gateway: PaymentGateway): PaymentGatewayAdapter => {
	const adapter = byGateway.get(gateway);

	if (!adapter?.isEnabled()) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Unsupported or disabled payment gateway",
		);
	}

	return adapter;
};

// Map a validated lowercase string (request body) to the enum.
export const parseGateway = (value: string): PaymentGateway => {
	const upper = value.toUpperCase() as PaymentGateway;

	if (!byGateway.has(upper)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Unsupported or disabled payment gateway",
		);
	}

	// resolves through getAdapter so a registered-but-unconfigured gateway
	// is rejected the same way as an unknown one
	return getAdapter(upper).gateway;
};

// env read at call time so tests / boot order never cache a stale answer
export const isStripeConfigured = () => Boolean(config.stripe_secret_key);
export const isSslcommerzConfigured = () =>
	Boolean(config.ssl_commerz_store_id && config.ssl_commerz_store_passwd);
