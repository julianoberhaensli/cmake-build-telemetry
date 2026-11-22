-- Step categories: shared legend rules that give matching steps (typically custom commands such
-- as code generators) their own name and colour on the build timeline. First match wins.
create table step_categories (
    id          bigint generated always as identity primary key,
    position    integer     not null,
    name        text        not null,
    color_slot  integer     not null check (color_slot between 1 and 8),
    role        text,                                   -- null = any role
    field       text        not null check (field in ('command', 'file', 'target')),
    pattern     text        not null,
    is_regex    boolean     not null default false,
    enabled     boolean     not null default true,
    updated_at  timestamptz not null default now()
);
