create table if not exists repository_revision (
  name text primary key,
  url text not null,
  commit_sha text not null,
  branch text,
  tag text,
  dirty boolean not null,
  revision_policy text not null,
  ingested_at timestamptz not null
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
  ingested_at timestamptz not null,
  primary key (repository, commit_sha, path)
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
  metadata_json jsonb not null,
  updated_at timestamptz not null,
  foreign key (repository, commit_sha, path)
    references source_file(repository, commit_sha, path)
    on delete cascade
);

create table if not exists source_relationship (
  source_id text not null references source_object(object_id) on delete cascade,
  target_id text not null references source_object(object_id) on delete cascade,
  relationship_type text not null,
  confidence double precision not null,
  evidence text not null,
  extractor text not null,
  updated_at timestamptz not null,
  primary key (source_id, target_id, relationship_type, evidence)
);

create index if not exists source_object_repo_idx on source_object(repository);
create index if not exists source_object_symbol_idx on source_object(symbol);
create index if not exists source_object_hash_idx on source_object(content_hash);
create index if not exists source_file_hash_idx on source_file(content_hash);
create index if not exists source_relationship_source_idx on source_relationship(source_id);
create index if not exists source_relationship_target_idx on source_relationship(target_id);
