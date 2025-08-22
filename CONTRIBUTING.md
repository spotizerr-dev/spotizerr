# Contributing guidelines

## Commit format

- All pull requests must be made to `dev` branch
- Use [conventional commit messages](https://www.conventionalcommits.org/en/v1.0.0/). E.g. `feat: add feature` or `fix: resolve issue #69420`


## Feature philosophy

- When implementing a feature related to downloading, follow the rule of choice: Every download must come from an active decision made by the user (e.g. clicking a download button, deciding the user wants a whole artist's discography, etc.). This takes out of the picture features like recommendation algorithms, auto-genererated playlists, etc.

