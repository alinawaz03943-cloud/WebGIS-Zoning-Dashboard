# Danville Zoning Lookup

Interactive zoning and land use explorer for City of Danville, Virginia. Zoning polygons are drawn over satellite imagery in a 2D map or a tilted 3D terrain view, with hover tooltips, click popups, search, and a dynamic legend.

## Features

- 2D map (Leaflet) and 3D terrain view (MapLibre GL); Imagery / Street map switcher in the bottom-right corner
- 1783 zoning polygons in 16 zoning classes, colored by zoning code
- Hover tooltip and click popup listing every attribute present in the data (including any overlays under the pointer)
- Optional overlay layers (from an `Overlay` folder), each its own named layer with an on/off switch
- Legend generated from the data; click an entry to highlight and zoom to it
- Search by zoning code or district name, layer toggle, fill-opacity slider, full-extent button
- Responsive layout for desktop, tablet and mobile; no API keys

## Data and limitations

- Source file: `va_danville.shp` (original kept unchanged in `data/source/`), reprojected from WGS 84 to WGS 84 (EPSG:4326) for the web.
- Attribute fields: `zone_code`, `zone_name`.
- Zoning code field: `zone_code`; zoning district name field: `zone_name`.
- Data source: Not stated in the supplied files.
- Overlay layers (Airport Overlay (1), Historic District (5)): each overlay is a separate layer named after the first two words of its `overlay_name`, with its own on/off switch. Hover and click show the overlays that cover the pointer.
- The dataset contains zoning polygons only. It has no parcels, addresses, permitted uses or regulations, so the map cannot tell you the zoning of a specific property.
- Imagery dates vary by location and are not guaranteed to be current.
- This is an informational tool. Confirm official zoning determinations with the City of Danville.

## Run locally

Open `index.html` directly (the app falls back to `data/zoning.js` when the browser blocks `fetch` on `file://`), or serve the folder:

```
python -m http.server 8000
```

then open http://localhost:8000.

## Publish on GitHub Pages

1. Create a public repository (for example `danville-va-zoning-lookup`) and upload everything in this folder to the `main` branch.
2. Go to **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, and Save.
3. After a minute the site is live at `https://<your-username>.github.io/danville-va-zoning-lookup/`.

## Troubleshooting

- **404 on GitHub Pages:** `index.html` must be at the repository root.
- **3D view not available:** it needs WebGL; the 2D map keeps working.
- **Imagery not showing:** check your network access to `server.arcgisonline.com`.

## Attribution

- Satellite imagery and street map: Esri (World Imagery, World Street Map) and their listed contributors; review [Esri's terms of use](https://www.esri.com/en-us/legal/terms/full-master-agreement) for your use case
- Place names: Esri World Boundaries and Places
- Terrain (3D view): Mapzen / AWS Terrain Tiles (USGS, NASA SRTM and others)
- Mapping libraries: Leaflet, MapLibre GL JS (bundled in `vendor/`)
- Zoning data: Not stated in the supplied files.
