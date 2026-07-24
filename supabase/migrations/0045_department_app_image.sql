-- reStrucAI - Department App backdrop image.
--
-- Each launchpad app can carry a transparent image that sits behind its tile on
-- the Apps page. The Board uploads and frames it in Manage Apps; the cropped,
-- framed result is stored inline as a data URL (a team registers only a handful
-- of apps, so no storage bucket is needed). Null falls back to the tile glyph.
alter table public.department_apps
  add column if not exists image_url text;
