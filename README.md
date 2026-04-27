# Parafour Innovations — Website

Static HTML/CSS website for Parafour Innovations, LLC — a propane dispenser manufacturer based in Georgetown, TX.

## Deployment

- **Host:** Cloudflare Pages
- **Repo:** `github.com/zmonroe101/parafour-website`
- **Branch:** `main` → auto-deploys to Cloudflare Pages

## Project Structure

```
parafour-website/
├── _headers            # Cloudflare security headers
├── _redirects          # Cloudflare redirects
├── css/
│   └── styles.css      # All styles — single stylesheet
├── js/
│   └── main.js         # Nav toggle + active link highlighting
├── images/             # Static assets (add here)
├── index.html          # Homepage
├── about/
├── products/
│   └── p4-series/
├── certifications/
├── contact/
├── support/
│   └── p4-series/
│       ├── manuals/
│       ├── troubleshooting/
│       ├── error-codes/
│       └── wiring/
└── admin/              # PIN-protected internal portal (noindex)
```

## Brand

| Variable               | Value     | Use                        |
|------------------------|-----------|----------------------------|
| `--color-primary`      | `#2E7D32` | Forest green — primary     |
| `--color-secondary`    | `#1565C0` | Royal blue — secondary CTA |
| `--color-accent`       | `#4CAF50` | Light green — hover/CTAs   |
| `--color-dark`         | `#1A1A1A` | Body text / dark sections  |
| `--color-light`        | `#F5F5F5` | Light section backgrounds  |
| `--font-primary`       | Inter     | All body and heading text  |

## Integrations

| Service   | Status       | Notes                                          |
|-----------|--------------|------------------------------------------------|
| HubSpot   | Placeholder  | Portal ID: 39562439 · embed when form ID ready |
| Supabase  | Phase 2      | Not yet configured                             |

## Admin Portal

- URL: `/admin/`
- PIN-protected (internal use only)
- Marked `noindex, nofollow` via `_headers` and meta tag
- Phase 2: Supabase integration for lead/support management

## Development Notes

- Pure static HTML/CSS — no build tools, no npm, no frameworks
- All CSS lives in `css/styles.css` — no inline styles in production pages
- All JS lives in `js/main.js`
- `.claude/` is gitignored — do not remove from `.gitignore`
- Google Fonts (Inter) loaded via CSS `@import` in `styles.css`

## Contact

- **Sales:** sales@parafour.com
- **Phone:** (512) 686-4099
- **Address:** 2534-A Shell Road, Georgetown, TX 78628
