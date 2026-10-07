/** Where "Make it" / "See what BB wrote" leads (C5): the landing draft for a landing move, otherwise the carousel
 *  Create surface. A plan from before formats existed has no surface in the response and keeps the carousel. */
export function createDestination(businessId: string, actionId: string, r: { surface?: 'landing' | 'carousel'; createHandoffId: string }): string {
  return r.surface === 'landing' ? `/b/${businessId}/landing/${actionId}` : `/b/${businessId}/create/${r.createHandoffId}`;
}
