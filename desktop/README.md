# Ultima III desktop app

A thin Electron shell around the built game in `../web`. See the developer
notes in `../web/README.md` for how it fits together, and the root README
for how to install the builds on Windows, macOS, Linux and the Steam Deck.

```sh
npm install
npm run bundle     # builds ../web with relative paths and copies dist/ into app/
npm start          # runs the app (add --fullscreen, --windowed, --new, --controller)
npm run smoke      # launches it, screenshots the running game, exits 0 on success
npm run dist       # installers for this platform into dist/ (dist:linux, dist:win, dist:mac)
```

Builds for all three platforms come from the "Desktop builds" workflow
under Actions: every run keeps them as artifacts, and a `v*` tag or a
manual run with "release" ticked attaches them to a draft release named
after `version` in `package.json`.
