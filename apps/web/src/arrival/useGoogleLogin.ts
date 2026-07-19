import { useEffect, useState } from 'react';
import { getAuthCapabilities } from '../api/client';

/**
 * Wave 1 correction — Continue-with-Google visibility is driven by SERVER-declared readiness, never a
 * frontend assumption. Defaults to hidden (undefined → false) so a planned-but-unconfigured control is
 * never shown as available; it appears only once the backend advertises googleLogin:true.
 */
export function useGoogleLoginAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    getAuthCapabilities().then((c) => { if (live) setAvailable(Boolean(c.googleLogin)); }).catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, []);
  return available;
}
