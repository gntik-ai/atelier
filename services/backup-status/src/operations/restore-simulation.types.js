/**
 * Types for restore simulation / drill mode.
 */
export const SAFE_SIMULATION_PROFILES = ['sandbox', 'integration'];
export function isSafeSimulationProfile(profile) {
    const normalized = profile.toLowerCase();
    return SAFE_SIMULATION_PROFILES.some((allowed) => normalized === allowed || normalized.includes(allowed));
}
