/**
 * @bb/application — Version→Offer mechanics anti-corruption layer (R2-A).
 *
 * Application-layer only: it composes the diagnosis read model (provenance) with
 * explicit mechanics context into an @bb/understanding-mechanics input. It owns
 * no mechanics state and never imports infrastructure/web/LLM.
 */
export * from './offer-context';
export * from './offer-acl';
export * from './evaluate-offer-use-case';
