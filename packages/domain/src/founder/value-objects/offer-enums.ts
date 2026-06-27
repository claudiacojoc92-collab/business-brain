/** Maps to bb_types.offer_availability in PostgreSQL. */
export type OfferAvailability = 'OPEN' | 'WAITLISTED' | 'FULL' | 'IN_DEVELOPMENT';

/** Maps to bb_types.offer_maturity in PostgreSQL. */
export type OfferMaturity = 'NEW' | 'ESTABLISHED' | 'PROVEN';

/** Maps to bb_types.offer_price_tier in PostgreSQL. */
export type OfferPriceTier = 'ACCESSIBLE' | 'MID' | 'PREMIUM';

/** Maps to bb_types.offer_sales_mechanism in PostgreSQL. */
export type OfferSalesMechanism = 'DISCOVERY_CALL' | 'APPLICATION' | 'DIRECT_PURCHASE';
