/**
 * flags.js
 * ========
 * Story / progress flags: simple true-or-false facts about the player's game
 * ("has met Aunty Kadi", "has shipped something"). Each flag is ONE BIT in the
 * save, so hundreds of them cost almost nothing.
 *
 * The id is the flag's bit position. Never change or reuse an id; add new
 * flags with the next free number (up to id 127).
 */
(function (FS) {
  'use strict';

  FS.Flags = FS.makeRegistry('Flags', [
    { id: 0, key: 'introSeen' },
    { id: 1, key: 'metKadi' },
    { id: 2, key: 'metSorie' },
    { id: 3, key: 'firstHarvest' },
    { id: 4, key: 'firstShipment' }
  ], 127);
})(FarmSim);
