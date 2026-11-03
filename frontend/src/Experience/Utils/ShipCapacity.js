export function getBarracksShipCapBonus(level = 1) {
  return [1, 3, 5, 7].reduce((sum, unlockLevel) =>
    sum + (level >= unlockLevel ? 1 : 0), 0);
}

export function getShipCapacity(state, islands) {
  const playerIslands = islands.filter(isl => isl.own === 'player');
  const barracksBonus = playerIslands.reduce((sum, isl) => {
    const instances = state.islandBuildings[isl.def.id] || [];
    return sum + instances.reduce((islandSum, inst) => {
      if (inst.buildingId !== 'barracks') return islandSum;
      if (inst.state === 'destroyed' || inst.state === 'building') return islandSum;
      return islandSum + getBarracksShipCapBonus(inst.level || 1);
    }, 0);
  }, 0);
  return 5 + barracksBonus;
}

export function getAlivePlayerShipCount(state) {
  return state.playerShips.filter(ship => ship.alive).length;
}
