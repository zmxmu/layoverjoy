"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockAtlasProvider = void 0;
const crypto_1 = require("crypto");
class MockAtlasProvider {
    name = 'MOCK';
    static STORY_PRICES = {
        'SIN-KUL': 210,
        'KUL-SIN': 205,
        'KUL-PVG': 282,
        'KUL-SHA': 282,
        'SIN-PVG': 420,
        'SIN-SHA': 420,
        'SIN-BKK': 190,
        'BKK-PVG': 305,
        'SIN-HKG': 240,
        'HKG-PVG': 260,
    };
    hash(s) {
        return (0, crypto_1.createHash)('sha256').update(s).digest().readUInt32BE(0);
    }
    basePrice(origin, destination) {
        const key = `${origin}-${destination}`;
        if (MockAtlasProvider.STORY_PRICES[key])
            return MockAtlasProvider.STORY_PRICES[key];
        return 150 + (this.hash(key) % 220);
    }
    async search(input) {
        const currency = input.currency || 'SGD';
        const date = new Date(`${input.departDate}T00:00:00Z`);
        const offers = [];
        const hours = [8, 13, 19];
        for (let i = 0; i < hours.length; i++) {
            const h = hours[i];
            const dep = new Date(date.getTime() + h * 3600_000);
            const arr = new Date(dep.getTime() + (2 + (this.hash(`${input.origin}${input.destination}${i}`) % 3)) * 3600_000);
            const price = this.basePrice(input.origin, input.destination) + i * 17;
            offers.push({
                providerOfferId: `mock-offer-${input.origin}-${input.destination}-${input.departDate}-${i}`,
                routingIdentifier: `mock-routing-${this.hash(input.origin + input.destination + input.departDate + i)}`,
                origin: input.origin,
                destination: input.destination,
                departureAt: dep.toISOString(),
                arrivalAt: arr.toISOString(),
                carrier: i === 0 ? 'AtlasDemo Air' : 'AtlasDemo Connect',
                flightNumber: `AD${100 + this.hash(input.origin + input.destination + i) % 800}`,
                currency,
                totalPrice: price,
                priceStatus: 'current',
                bookable: true,
                baggageJson: { includedCheckedBags: i === 2 ? 0 : 1 },
            });
        }
        offers.push({
            ...offers[0],
            providerOfferId: `${offers[0].providerOfferId}-ref`,
            priceStatus: 'reference',
            bookable: false,
            totalPrice: offers[0].totalPrice - 12,
        });
        return offers;
    }
    async verify(offerIdentifier) {
        const drift = offerIdentifier.includes('-drift');
        const base = 282;
        return {
            providerOfferId: offerIdentifier.replace(/-drift$/, ''),
            sessionId: `mock-session-${(0, crypto_1.randomUUID)().slice(0, 8)}`,
            currency: 'SGD',
            totalPrice: drift ? Math.round(base * 1.08) : base,
            priceStatus: 'current',
            priceChanged: drift,
            previousTotal: drift ? base : undefined,
            bookable: true,
            bookingRequirements: { passengersRequired: true, contactRequired: true },
        };
    }
    async createOrder(input) {
        const fail = input.bookingReference.includes('-legb-fail');
        if (fail) {
            const err = new Error('INVENTORY_CHANGED');
            err.providerCode = 'INVENTORY_UNAVAILABLE';
            throw err;
        }
        const orderNo = `MOCK-ORD-${(0, crypto_1.randomUUID)().slice(0, 8).toUpperCase()}`;
        return {
            orderNo,
            status: 'CREATED',
            currency: 'SGD',
            amount: 282,
            paymentConfirmationId: `mock-pay-${(0, crypto_1.randomUUID)().slice(0, 8)}`,
        };
    }
    async pay(input) {
        if (input.orderNo.includes('FAIL'))
            return { status: 'FAILED', providerCode: 'PAYMENT_DECLINED' };
        if (input.orderNo.includes('UNKNOWN'))
            return { status: 'UNKNOWN', providerCode: 'OUTCOME_UNKNOWN' };
        return { status: 'PAID', providerCode: 'PAYMENT_SUCCESS' };
    }
    async refund(_input) {
        return { status: 'SIMULATED_REFUNDED', providerCode: 'SIMULATED_REFUND' };
    }
    async getOrder(orderNo) {
        return { orderNo, status: 'CREATED', currency: 'SGD', amount: 282 };
    }
}
exports.MockAtlasProvider = MockAtlasProvider;
