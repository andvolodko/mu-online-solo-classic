#pragma once

// Effects can carry hit detection and outgoing attack packets. Ambient effects
// must leave capacity for the local player's attacks, even in crowded maps.
// Keep the existing pool sizes/render budgets; never evict a live projectile.
template <unsigned N>
char* AllocateEffectSlot(char (&pool)[N], unsigned stride, unsigned ambientLimit,
                         bool localAttack)
{
    const unsigned total = N / stride;
    const unsigned limit = localAttack ? total : ambientLimit;
    static unsigned next = 0;
    for (unsigned n = 0; n < limit; ++n) {
        const unsigned index = (next + n) % limit;
        char* slot = pool + index * stride;
        if (!slot[0]) {
            next = (index + 1) % total;
            return slot;
        }
    }
    return nullptr;
}
