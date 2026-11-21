-- BuildTelemetry schema v1
-- builds: one row per CMake instrumentation index (= one build invocation)
-- build_steps: one row per instrumented command (configure, compile, link, ...)

create table projects (
    id          bigint generated always as identity primary key,
    name        text        not null unique,
    first_seen  timestamptz not null default now(),
    last_seen   timestamptz not null default now()
);

create table machines (
    id              bigint generated always as identity primary key,
    machine_key     text        not null unique,
    hostname        text,
    os_name         text,
    os_release      text,
    os_pretty       text,
    os_platform     text,
    cpu_model       text,
    cpu_vendor      text,
    logical_cores   integer,
    physical_cores  integer,
    cpu_mhz         double precision,
    memory_mb       bigint,
    is_ci           boolean     not null default false,
    first_seen      timestamptz not null default now(),
    last_seen       timestamptz not null default now()
);

create table builds (
    id                   uuid primary key,
    project_id           bigint      not null references projects (id),
    machine_id           bigint      not null references machines (id),
    received_at          timestamptz not null default now(),
    started_at           timestamptz not null,
    finished_at          timestamptz not null,
    wall_ms              bigint      not null,
    configure_ms         bigint      not null default 0,
    generate_ms          bigint      not null default 0,
    hook                 text,
    kind                 text        not null,   -- full | incremental | configure | other
    success              boolean     not null,
    compile_count        integer     not null default 0,
    compile_ms           bigint      not null default 0,
    link_count           integer     not null default 0,
    link_ms              bigint      not null default 0,
    custom_count         integer     not null default 0,
    custom_ms            bigint      not null default 0,
    failed_count         integer     not null default 0,
    total_step_ms        bigint      not null default 0,
    parallelism          double precision,
    max_rss_kb           bigint,
    output_bytes         bigint,
    build_type           text,
    generator            text,
    build_tool           text,
    cmake_version        text,
    cxx_compiler_id      text,
    cxx_compiler_version text,
    c_compiler_id        text,
    c_compiler_version   text,
    compiler_launcher    text,
    linker_type          text,
    branch               text,
    commit_sha           text,
    is_ci                boolean     not null default false,
    ci_provider          text,
    ci_url               text,
    ci_job               text,
    user_hash            text,
    detail               text,
    client_version       text,
    data_version         text,
    ingest_key           text,
    source_dir           text,
    build_dir            text,
    tags                 jsonb       not null default '{}'::jsonb,
    role_stats           jsonb,
    system_info          jsonb,
    commands_purged      boolean     not null default false
);

create index ix_builds_started        on builds (started_at desc);
create index ix_builds_project_start  on builds (project_id, started_at desc);
create index ix_builds_machine_start  on builds (machine_id, started_at desc);
create index ix_builds_branch         on builds (branch) where branch is not null;
create index ix_builds_tags           on builds using gin (tags);

create table build_steps (
    build_id        uuid    not null references builds (id) on delete cascade,
    seq             integer not null,
    project_id      bigint  not null,
    role            text    not null,
    target          text,
    target_type     text,
    source          text,
    output          text,
    language        text,
    config          text,
    start_offset_ms bigint  not null,
    duration_ms     bigint  not null,
    result          integer,
    output_bytes    bigint,
    max_rss_kb      bigint,
    user_time_us    bigint,
    system_time_us  bigint,
    command         text,
    primary key (build_id, seq)
);

create index ix_steps_project_source on build_steps (project_id, source) where role = 'compile';
create index ix_steps_project_target on build_steps (project_id, target);
