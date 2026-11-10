/* A Saved Game: five levels of sums. The learner's level is saved, so they
   carry on where they left off, on any device their platform syncs to. */
(function () {
  "use strict";
  var LEVELS = 5;
  var t = EduGame.t;
  var level = 1;      // the level being played
  var question = null;
  var $ = function (id) { return document.getElementById(id); };

  // Where saves go, in words the learner understands (lang/*.json: where_account ...).
  var WHERE = { "kolibri-games": "where_account", scorm: "where_account", sugarizer: "where_journal", local: "where_browser" };
  var platform = "local";

  function newQuestion() {
    var a = 1 + Math.floor(Math.random() * level * 4);
    var b = 1 + Math.floor(Math.random() * level * 4);
    var right = a + b;
    var choices = [right, right + 1 + Math.floor(Math.random() * 3), Math.max(0, right - 1 - Math.floor(Math.random() * 3))];
    choices.sort(function () { return Math.random() - 0.5; });
    question = { a: a, b: b, right: right, choices: choices };
  }

  function show() {
    var done = level > LEVELS;
    $("level").textContent = done ? t("all_done") : t("level", { n: level, total: LEVELS });
    $("question").textContent = done ? "" : t("question", { a: question.a, b: question.b });
    var box = $("answers");
    box.textContent = "";
    if (done) return;
    question.choices.forEach(function (value) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = String(value);
      button.addEventListener("click", function () { answer(value); });
      box.appendChild(button);
    });
  }

  function answer(value) {
    if (value !== question.right) {
      $("feedback").textContent = t("wrong");
      return;
    }
    level += 1;
    EduGame.save({ level: level });          // save after every step
    if (level > LEVELS) EduGame.complete();  // tell the platform the activity is done
    $("feedback").textContent = level > LEVELS ? "" : t("right", { n: level });
    newQuestion();
    show();
  }

  $("restart").addEventListener("click", function () {
    level = 1;
    EduGame.save({ level: level });
    $("feedback").textContent = "";
    newQuestion();
    show();
  });

  EduGame.ready().then(function (info) {
    if (info.save && info.save.level) level = info.save.level;
    platform = info.platform;
    showWhere();
    newQuestion();
    show();
  });

  function showWhere() {
    $("where").textContent = t("saved_where", { where: t(WHERE[platform] || "where_browser") });
  }

  // The learner chose another language in Options: redo the words made here.
  EduGame.on("languagechange", function () { showWhere(); if (question) show(); });
})();
