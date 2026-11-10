/**
 * currencies.js
 * =============
 * Kinds of money. The player's purse (state.wallet) holds an amount of each.
 *
 *   cowrie   cowrie shells - the everyday money, used for all prices so far.
 *
 * TO ADD A CURRENCY (e.g. Kissi pennies, the iron currency once used in
 * Sierra Leone, Guinea and Liberia):
 *   1. Add { id: 1, key: 'kissi', icon: <item icon number> } below.
 *   2. Add 'money_kissi' to strings.js, and draw an icon (build_assets.py).
 *   3. Give items a `currency: 'kissi'` field where something should cost
 *      Kissi pennies instead of cowries.
 *   Old saves pick up the new currency automatically (starting at 0).
 *
 * Amounts are whole numbers up to 16,777,215 per currency (24 bits in the save).
 */
(function (FS) {
  'use strict';

  FS.Currencies = FS.makeRegistry('Currencies', [
    { id: 0, key: 'cowrie', icon: 12 }
  ], 15);

  FS.Currencies.MAIN = 'cowrie';   // used when an item doesn't name a currency
  FS.Currencies.MAX = 16777215;
})(FarmSim);
