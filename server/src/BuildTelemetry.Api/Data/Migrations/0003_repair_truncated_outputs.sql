-- CMake's instrumentation receives custom-command outputs with broken quoting on Windows and
-- keeps only the part before the first space ("C:/Program" for "C:/Program Files/..."). New
-- bundles are repaired at ingest (BundleNormalizer.RepairOutput); this fixes stored steps the
-- same way: take the last quoted path in the command line that continues the truncated one,
-- unless it is the program at the very start of the command.
with c as (
    select s.build_id, s.seq, s.output,
           replace(s.command, '\', '/') as cmd,
           case when b.build_dir is null or b.build_dir like '$%' then null
                else rtrim(replace(b.build_dir, '\', '/'), '/') end as bdir,
           s.output ~ '^([A-Za-z]:)?/' as rooted
    from build_steps s
    join builds b on b.id = s.build_id
    where s.command is not null and s.output is not null and s.output <> '' and position(' ' in s.output) = 0
), k as (
    select build_id, seq, cmd, bdir,
           case when rooted then '"' || output || ' '
                when bdir is not null then '"' || bdir || '/' || replace(output, '\', '/') || ' ' end as key
    from c
), l as (
    -- 1-based position of the last occurrence of key
    select build_id, seq, cmd, bdir,
           length(cmd) - strpos(reverse(lower(cmd)), reverse(lower(key))) - length(key) + 2 as pos
    from k
    where key is not null and strpos(lower(cmd), lower(key)) > 0
), m as (
    select build_id, seq, bdir, split_part(substr(cmd, pos + 1), '"', 1) as fixed
    from l
    where pos > 1
)
update build_steps s
set output = case when m.bdir is not null and lower(left(m.fixed, length(m.bdir) + 1)) = lower(m.bdir) || '/'
                  then substr(m.fixed, length(m.bdir) + 2)
                  else m.fixed end
from m
where s.build_id = m.build_id and s.seq = m.seq and m.fixed <> '';
