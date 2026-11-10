/**
 * saveProblem.js
 * ==============
 * The message shown when the learner's saved farm can't be loaded: it's damaged
 * (cut off on its way, say), or it was saved by a newer version of the game.
 * Nothing is saved over it (Session.problem) until the learner chooses:
 *
 *   Play without saving    play a new farm; the saved one stays as it is
 *   Start a new farm       only for a damaged save: saving starts again
 *
 * A save from a newer version can't be started over here: the learner plays it
 * where it was made. It's a plain web page box over the game (no Phaser), so it
 * works before the game has started.
 */
(function (FS) {
  'use strict';

  function button(text, primary) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (primary) b.className = 'primary';
    return b;
  }

  FS.SaveProblem = {
    /** Show the message for FS.Session.problem (does nothing without one, or twice). */
    show: function () {
      const problem = FS.Session.problem;
      if (!problem || document.getElementById('save-problem')) return;
      const box = document.createElement('div');
      box.id = 'save-problem';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', 'save-problem-title');
      const card = document.createElement('div');
      const title = document.createElement('h2');
      title.id = 'save-problem-title';
      title.textContent = FS.t('save_problem_title');
      const text = document.createElement('p');
      text.textContent = FS.t(problem.kind === 'newer' ? 'save_problem_newer' : 'save_problem_damaged');
      const note = document.createElement('p');
      note.textContent = FS.t('save_problem_unsaved');
      const stay = button(FS.t('save_play_without'), true);
      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      buttons.appendChild(stay);
      let fresh = null;
      if (problem.kind !== 'newer') {
        fresh = button(FS.t('save_new_farm'), false);
        buttons.appendChild(fresh);
      }
      card.appendChild(title);
      card.appendChild(text);
      card.appendChild(note);
      card.appendChild(buttons);
      box.appendChild(card);
      // Keys pressed here (Space on a button) mustn't reach the game behind.
      box.addEventListener('keydown', function (e) { e.stopPropagation(); });
      box.addEventListener('keyup', function (e) { e.stopPropagation(); });
      function close() { if (box.parentNode) box.parentNode.removeChild(box); }
      stay.addEventListener('click', close);
      if (fresh) {
        fresh.addEventListener('click', function () {
          FS.Session.startNewFarm().then(close, close);
        });
      }
      document.body.appendChild(box);
      stay.focus();
    }
  };
})(FarmSim);
