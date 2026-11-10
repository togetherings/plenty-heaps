# EduGame template

A starting point for an educational game made with [EduGame Kit](https://github.com/togetherings/edugame-kit),
that you can change and publish **without installing anything**: GitHub checks and builds the game for you.

The same game works in Kolibri (through Kolibri Studio), Moodle and other learning systems, RACHEL, Sugarizer and
Kiwix, and on its own web page. This starter is a **Saved Game**: it keeps each learner's progress (a level to
reach). For a game that keeps scores too, see [making games](https://github.com/togetherings/edugame-kit/blob/main/docs/MAKING_GAMES.md).

## Start

1. Click **Use this template** > **Create a new repository** at the top of this page. Make it public if you want a free
   GitHub Pages site.
2. In your new repository, open **Settings > Pages**, and under **Build and deployment** set **Source** to
   **GitHub Actions**.
3. Change the game in GitHub's editor (open a file, then the pencil button):
   - `edugame.json`: change `id` to one of your own, like `org.yourname.my-game`. Never change it once learners
     have played, or their progress is lost.
   - `lang/en.json` and `lang/fr.json`: the game's title, description and every word it shows.
   - `index.html`, `game.js`, `style.css`: the game itself.

Each time you commit a change, GitHub checks the game and builds it (the **Actions** tab). If something is wrong,
the run fails and says what. Your game's page appears at `https://<your account>.github.io/<repository>/`.

## Get the zips

- **To try a change:** open the **Actions** tab, then the latest **Build** run, and download **game-zips** at the
  bottom.
- **For schools:** in **Releases > Draft a new release**, make a tag like `v0.1.0` that matches `version` in
  `edugame.json`, and publish. The zips are attached to the release a few minutes later.

To put the game in Kolibri, upload the zip to a channel in Kolibri Studio as an HTML5 app.

## Learn more

- [Making games](https://github.com/togetherings/edugame-kit/blob/main/docs/MAKING_GAMES.md): `edugame.json`, saving and scores
- [Languages](https://github.com/togetherings/edugame-kit/blob/main/docs/LANGUAGES.md): words, translations, the Options button
- [The save helper](https://github.com/togetherings/edugame-kit/blob/main/docs/HELPER.md): the calls your game uses
- [GitHub Pages](https://github.com/togetherings/edugame-kit/blob/main/docs/platforms/GITHUB_PAGES.md): the web page, and counting visits

If you'd rather work on your own computer, install the kit (`pip install git+https://github.com/togetherings/edugame-kit.git`)
and run `edugame preview .` to play the game as you change it.

---

*This repository is made by EduGame Kit's `tools/make_template_repo.py`, and kept up to date by its workflow. Change
the starter in the kit (`edugame/templates/`), not here: changes made here are replaced.*
