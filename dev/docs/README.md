# Documentation authoring

These guides own the structure and explanation of public documentation, not
another copy of component behavior or API inventories. Begin with the site plan
and conventions, then choose the template for the page being changed.

| Guide | Responsibility |
|---|---|
| [DOCS-SITE-PLAN.md](DOCS-SITE-PLAN.md) | Routes, navigation, page ownership and demo placement |
| [DOCS-CONVENTIONS.md](DOCS-CONVENTIONS.md) | Maintained English prose, links, demos, actual check coverage and manual acceptance |
| [COMPONENT-PAGE-TEMPLATE.md](COMPONENT-PAGE-TEMPLATE.md) | A Web Component or a complete workflow, Parameters, attributes/properties/events and styling |
| [HEADLESS-PAGE-TEMPLATE.md](HEADLESS-PAGE-TEMPLATE.md) | Factories, options, commands, state, events and lifecycle |
| [UIKIT-PAGE-TEMPLATE.md](UIKIT-PAGE-TEMPLATE.md) | Presenter bindings, named handles, interaction, styling and composition |
| [API-PAGE-TEMPLATE.md](API-PAGE-TEMPLATE.md) | Public package entries and complete API ownership |

For a behavioral or component change, first use the [design contracts](../design/README.md)
and inspect source, exported types and tests. Public page source remains in
[the docs app](../../apps/doc/webmusic/src/content/docs/); demo infrastructure is
mapped in [Conventions](DOCS-CONVENTIONS.md#demo-file-ownership) and
[the apps handbook](../../apps/README.md).

[COMPONENTS](../COMPONENTS.md) and [DOCUMENTATION-MAP](../DOCUMENTATION-MAP.md)
are generated discovery tools. After adding or moving a document, update its
navigation and links, run `npm run docs:sync`, and follow
[Development](../DEVELOPMENT.md) for checks. Automated gates and a successful
site build do not establish complete API semantics or browser acceptance.

Return to the [development entry point](../README.md).
