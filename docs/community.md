# Community

MySTRA is an open project, intentionally early. It is developed in the open on GitHub by [Lightcone Research](https://github.com/LightconeResearch), alongside the [ASTRA specification](https://astra-spec.org/) it renders. The most valuable thing the project can have right now — while it is still in alpha — is contact with people actually writing reports with it.

## Where to find us

| Channel | Use it for |
|---------|-----------|
| [`MySTRA` issues](https://github.com/LightconeResearch/MySTRA/issues) | Plugin bugs, rendering issues, authoring-vocabulary proposals, doc issues. |
| [`astra-spec` issues](https://github.com/LightconeResearch/astra-spec/issues) | Schema and specification questions. |
| Pull requests | Code and documentation changes. |

When in doubt: if it's about how something *renders or is referenced in a report*, it belongs here; if it's about what an `astra.yaml` *can express*, it belongs in `astra-spec`.

## What's most useful right now

- **Real-report attempts.** Take an analysis you actually ran, express it in ASTRA, and write the report with MySTRA. Report what fits, what doesn't, and where the vocabulary forced a workaround — the single best signal for what to fix.
- **Theme experiments.** Build a MyST theme against the [theming contract](reference/theming.md). What is awkward to consume from the resolved store is information the plugin authors otherwise don't have.
- **Documentation fixes** — typos, unclear passages, missing examples. Small enough to ship the same day.

## Contributing

The short version:

1. **Open an issue first** for anything non-trivial.
2. **Keep changes focused** — a plugin change and a doc change are two pull requests.
3. **Run the checks** locally before pushing:

    ```bash
    npm run build    # type-check + compile
    npm test         # plugin-emission + store + parser tests
    ```

All commits require a DCO sign-off (`git commit -s`).

## License

MySTRA is released under the [BSD 3-Clause license](https://github.com/LightconeResearch/MySTRA/blob/main/LICENSE).
