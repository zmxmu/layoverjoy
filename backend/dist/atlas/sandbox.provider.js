"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxAtlasProvider = void 0;
const crypto_1 = require("crypto");
const errors_1 = require("../common/errors");
class SandboxAtlasProvider {
    baseUrl;
    clientId;
    clientSecret;
    timeoutMs;
    cid;
    name = 'ATLAS_SANDBOX';
    constructor(baseUrl, clientId, clientSecret, timeoutMs = 8000, cid = '') {
        this.baseUrl = baseUrl;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.timeoutMs = timeoutMs;
        this.cid = cid;
    }
    headers() {
        return {
            'content-type': 'application/json',
            'x-atlas-client-id': this.clientId,
            'x-atlas-client-secret': this.clientSecret,
        };
    }
    async post(path, body, allowRetry = false) {
        const attempt = async () => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
            try {
                const res = await fetch(`${this.baseUrl}${path}`, {
                    method: 'POST',
                    headers: this.headers(),
                    body: JSON.stringify(body ?? {}),
                    signal: ctrl.signal,
                });
                let json = null;
                try {
                    json = await res.json();
                }
                catch {
                    json = null;
                }
                return { status: res.status, json };
            }
            finally {
                clearTimeout(timer);
            }
        };
        try {
            return await attempt();
        }
        catch (e) {
            if (allowRetry) {
                try {
                    return await attempt();
                }
                catch {
                    throw new errors_1.AppError('ATLAS_TIMEOUT', '航班服务响应超时，请稍后重试。', 504, true, { provider: this.name });
                }
            }
            throw new errors_1.AppError('ATLAS_TIMEOUT', '航班服务响应超时，请稍后重试。', 504, true, { provider: this.name });
        }
    }
    mapHttpError(status, json, operation) {
        const providerCode = json?.code || json?.errorCode || json?.error?.code || String(status);
        if (status === 308) {
            throw new errors_1.AppError('PRICE_CHANGED', '航班价格已变化，请确认后继续。', 409, false, { providerCode });
        }
        if (status === 401 || status === 403) {
            throw new errors_1.AppError('PROVIDER_AUTH_FAILED', '航班服务认证失败，请联系管理员。', 502, false, { providerCode });
        }
        if (status === 429) {
            throw new errors_1.AppError('PROVIDER_RATE_LIMITED', '航班服务限流，请稍后重试。', 429, true, { providerCode });
        }
        if (operation === 'ORDER' || operation === 'PAY') {
            throw new errors_1.AppError('PROVIDER_OUTCOME_UNKNOWN', '订单结果不明确，仅可查询订单状态，不会自动重试。', 500, false, { providerCode });
        }
        throw new errors_1.AppError('ATLAS_PROVIDER_ERROR', '航班服务返回异常，请稍后重试。', 502, true, { providerCode });
    }
    pick(obj, keys) {
        for (const k of keys) {
            if (obj?.[k] !== undefined && obj?.[k] !== null)
                return obj[k];
        }
        return undefined;
    }
    async search(input) {
        const { status, json } = await this.post('/search.do', {
            origin: input.origin,
            destination: input.destination,
            departDate: input.departDate,
            adults: input.adults ?? 1,
            currency: input.currency,
            airlines: input.airlines,
        }, true);
        if (status !== 200)
            this.mapHttpError(status, json, 'SEARCH');
        const rawOffers = this.pick(json, ['offers']) ||
            this.pick(json?.data, ['offers', 'routings', 'flightRoutings', 'results']) ||
            [];
        const offers = [];
        for (const o of Array.isArray(rawOffers) ? rawOffers : []) {
            const providerOfferId = this.pick(o, ['offer_id', 'offerId', 'id', 'routingIdentifier']);
            if (!providerOfferId)
                continue;
            const seg = this.pick(o, ['segment', 'segments', 'flightSegment']) || {};
            const firstSeg = Array.isArray(seg) ? seg[0] : seg;
            offers.push({
                providerOfferId: String(providerOfferId),
                routingIdentifier: this.pick(o, ['routingIdentifier', 'routing_identifier', 'search_id', 'searchId']),
                origin: this.pick(firstSeg, ['origin', 'from', 'departureAirport']) ?? input.origin,
                destination: this.pick(firstSeg, ['destination', 'to', 'arrivalAirport']) ?? input.destination,
                departureAt: this.pick(o, ['departureAt', 'departureTime', 'departTime']) || this.pick(firstSeg, ['departureTime', 'departTime']),
                arrivalAt: this.pick(o, ['arrivalAt', 'arrivalTime', 'arriveTime']) || this.pick(firstSeg, ['arrivalTime', 'arriveTime']),
                carrier: this.pick(o, ['carrier', 'marketingCarrier', 'airline']) || this.pick(firstSeg, ['carrier', 'airline']),
                flightNumber: this.pick(o, ['flightNumber', 'flightNo']) || this.pick(firstSeg, ['flightNumber', 'flightNo']),
                currency: this.pick(o, ['currency']) || input.currency || 'SGD',
                totalPrice: Number(this.pick(o, ['totalPrice', 'total_price', 'price', 'amount', 'totalAmount']) ?? 0),
                priceStatus: (this.pick(o, ['priceStatus', 'price_status']) || 'current'),
                bookable: this.pick(o, ['bookable']) !== false,
                baggageJson: this.pick(o, ['baggageElements', 'baggage']),
                raw: o,
            });
        }
        if (offers.length === 0) {
            throw new errors_1.AppError('NO_SANDBOX_INVENTORY', 'Atlas Sandbox 暂无该航线的测试航班数据。', 404, false, { origin: input.origin, destination: input.destination, departDate: input.departDate });
        }
        return offers;
    }
    async verify(offerIdentifier) {
        const { status, json } = await this.post('/verify.do', { offerId: offerIdentifier, routingIdentifier: offerIdentifier });
        if (status !== 200)
            this.mapHttpError(status, json, 'VERIFY');
        const data = json?.data ?? json ?? {};
        const price = Number(this.pick(data, ['totalPrice', 'total_price', 'price', 'amount']) ?? 0);
        return {
            providerOfferId: String(this.pick(data, ['offer_id', 'offerId', 'id']) || offerIdentifier),
            sessionId: this.pick(data, ['sessionId', 'session_id', 'bookingId', 'booking_id']),
            currency: this.pick(data, ['currency']) || 'SGD',
            totalPrice: price,
            priceStatus: 'current',
            priceChanged: this.pick(data, ['priceChanged']) === true,
            bookable: this.pick(data, ['bookable']) !== false,
            bookingRequirements: this.pick(data, ['bookingRequirements', 'booking_requirements']),
        };
    }
    async createOrder(input) {
        const { status, json } = await this.post('/order.do', {
            sessionId: input.bookingReference,
            passengers: input.passengers,
        });
        if (status !== 200)
            this.mapHttpError(status, json, 'ORDER');
        const data = json?.data ?? json ?? {};
        return {
            orderNo: String(this.pick(data, ['orderNo', 'order_no', 'orderNumber']) || ''),
            status: String(this.pick(data, ['status']) || 'CREATED'),
            currency: this.pick(data, ['currency']),
            amount: Number(this.pick(data, ['amount', 'totalPrice']) ?? 0) || undefined,
            paymentConfirmationId: this.pick(data, ['paymentConfirmationId', 'payment_confirmation_id']),
        };
    }
    async pay(input) {
        const { status, json } = await this.post('/pay.do', {
            orderNo: input.orderNo,
            paymentConfirmationId: input.paymentConfirmationId,
        });
        if (status !== 200)
            this.mapHttpError(status, json, 'PAY');
        const data = json?.data ?? json ?? {};
        const s = String(this.pick(data, ['status']) || '').toUpperCase();
        return {
            status: s.includes('SUCCESS') || s.includes('PAID') ? 'PAID' : s.includes('FAIL') ? 'FAILED' : 'UNKNOWN',
            providerCode: this.pick(data, ['code']),
        };
    }
    async refund(input) {
        return { status: 'SIMULATED_REFUNDED', providerCode: 'SIMULATED_REFUND' };
    }
    async getOrder(orderNo) {
        const { status, json } = await this.post('/queryOrderDetails.do', { orderNo });
        if (status !== 200)
            this.mapHttpError(status, json, 'QUERY');
        const data = json?.data ?? json ?? {};
        return {
            orderNo: String(this.pick(data, ['orderNo', 'order_no']) || orderNo),
            status: String(this.pick(data, ['status']) || 'UNKNOWN'),
            currency: this.pick(data, ['currency']),
            amount: Number(this.pick(data, ['amount', 'totalPrice']) ?? 0) || undefined,
        };
    }
    async updateWebhookUrl(url) {
        const body = { url };
        if (this.cid)
            body.cid = this.cid;
        const { status, json } = await this.post('/updateWebhookURL.do', body);
        const rawHash = (0, crypto_1.createHash)('sha256').update(JSON.stringify(json ?? {})).digest('hex');
        return { status, rawHash };
    }
}
exports.SandboxAtlasProvider = SandboxAtlasProvider;
