# SpecView Format Reference

This project uses a `design-spec.yaml` file to define the design system. Follow this format exactly when creating or modifying the spec.

## Structure

```yaml
meta:
  version: "1.0"
  name: "Project Name"
  description: "Optional"

tokens:
  # Shared design tokens — DTCG format ($value + $type)

components:
  # Component specifications

globals:
  # Optional app-wide defaults (body, scrollbar, focus, selection)

layouts:
  # Optional page-level component trees
```

## Tokens

Use DTCG format. Every token needs `$value` and `$type`.

```yaml
tokens:
  colors:
    brand:
      primary: { $value: "#2563EB", $type: color }
  spacing:
    md: { $value: "12px", $type: dimension }
  typography:
    body:
      $value: { fontFamily: "Inter", fontWeight: 400, fontSize: "14px", lineHeight: "22px" }
      $type: typography
  shadows:
    sm:
      $value: { offsetX: "0", offsetY: "1px", blur: "3px", spread: "0", color: "rgba(0,0,0,0.04)" }
      $type: shadow
```

Valid `$type` values: `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`, `shadow`, `border`, `typography`.

Reference tokens with `{path.to.token}`:

```yaml
background: "{colors.brand.primary}"   # resolves to #2563EB
padding: "{spacing.md}"                # resolves to 12px
```

## Components

```yaml
components:
  ComponentName:
    archetype: button        # renderer type (see list below)
    category: "Actions"      # sidebar grouping
    description: "What this component does"
    extends: ParentComponent # optional — inherits everything from parent

    base:                    # default properties
      background: "{colors.brand.primary}"
      border-radius: "{radii.md}"
      padding-x: "16px"
      font-size: "14px"

    variants:                # style overrides per variant × state
      primary:
        default:
          background: "{colors.brand.primary}"
          color: "#FFFFFF"
        hover:
          background: "{colors.brand.primary-hover}"
        disabled:
          background: "{colors.neutral.200}"
          cursor: not-allowed
      secondary:
        default:
          background: transparent
          border: { width: "1px", style: solid, color: "{colors.neutral.200}" }

    sizes:                   # dimension overrides per size
      sm:
        font-size: "12px"
        padding-x: "12px"
      lg:
        font-size: "16px"
        padding-x: "24px"

    slots:                   # composition — what goes inside
      label: { accepts: [text], required: true }
      icon:  { accepts: [Icon], required: false }

    rules:                   # plain-text constraints
      - "Min touch target: 44x44px"
      - "Disabled buttons do not show hover states"
```

### Override chain

Properties resolve in this order (later wins):

```
parent.base → base → sizes.{size} → variants.{variant}.default → variants.{variant}.{state}
```

### Inheritance

`extends` copies everything from the parent. The child can override any section:
- `base`: shallow merge (child wins on conflict)
- `slots`: merge (set to `null` to remove a parent slot)
- `variants`/`sizes`: deep merge
- `rules`: appended after parent's (prefix with `!replace:` to discard parent rules)

Single level only — no A extends B extends C.

### Archetypes

`button` `card` `tabs` `bar` `stat` `badge` `nav-item` `toggle` `input` `select` `checkbox` `radio` `modal` `table` `avatar` `alert` `tooltip` `progress` `pill` `accordion` `generic`

## Rules for writing specs

1. Always use token references (`{path}`) instead of raw values when a token exists
2. Put shared values in `tokens`, not duplicated across components
3. Use `extends` for components that share a base pattern (e.g. DataRow → PlayerRow, SpellRow)
4. Keep `rules` as clear, actionable natural language
5. Every component needs `archetype`, `category`, and `description`
6. Use `base` for the default appearance; only put differences in `variants` and `sizes`
