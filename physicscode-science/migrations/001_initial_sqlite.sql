create table if not exists repository_revision (
  name text primary key,
  url text not null,
  commit_sha text not null,
  branch text,
  tag text,
  dirty integer not null,
  revision_policy text not null,
  ingested_at text not null
);

create table if not exists source_object (
  object_id text primary key,
  repository text not null,
  repository_url text not null,
  commit_sha text not null,
  path text not null,
  start_line integer not null,
  end_line integer not null,
  symbol text not null,
  object_type text not null,
  language text not null,
  license text not null,
  content_hash text not null,
  parser_version text not null,
  raw_content text not null,
  metadata_json text not null,
  updated_at text not null
);

create table if not exists source_file (
  repository text not null,
  commit_sha text not null,
  path text not null,
  language text not null,
  license text not null,
  license_source text not null,
  content_hash text not null,
  snapshot_path text not null,
  ingested_at text not null,
  primary key (repository, commit_sha, path)
);

create table if not exists source_relationship (
  source_id text not null,
  target_id text not null,
  relationship_type text not null,
  confidence real not null,
  evidence text not null,
  extractor text not null,
  updated_at text not null,
  primary key (source_id, target_id, relationship_type, evidence)
);
