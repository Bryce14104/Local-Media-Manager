//! Burst groups, semantic clusters, and caption tags.
//!
//! `clusters`, `cluster_members`, and `media_captions` are rebuilt from the
//! faces and subject tags already stored for this library. The AI Insights
//! view reads those tables back.

use std::collections::HashMap;

use rusqlite::{Connection, params};

use super::DbError;
use crate::models::{ConceptCluster, ConceptIndex, MediaCaption};

const BURST_GAP_SECS: i64 = 600;

struct Draft {
    kind: &'static str,
    label: String,
    summary: String,
    score: f32,
    source_id: Option<i64>,
    members: Vec<(i64, f32)>,
}

struct CaptionRow {
    media_id: i64,
    tag: String,
    caption: String,
    score: f32,
}

pub(super) fn write(conn: &mut Connection) -> Result<(), DbError> {
    let mut drafts = burst_drafts(conn)?;
    drafts.extend(semantic_drafts(conn)?);
    drafts.extend(person_drafts(conn)?);
    let captions = caption_rows(conn)?;
    let now = super::unix_now();
    let tx = conn.transaction()?;
    tx.execute_batch(
        "DELETE FROM cluster_members;
         DELETE FROM media_captions;
         DELETE FROM clusters;",
    )?;
    for draft in drafts {
        tx.execute(
            "INSERT INTO clusters (kind, label, summary, score, source_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                draft.kind,
                draft.label,
                draft.summary,
                draft.score,
                draft.source_id,
                now
            ],
        )?;
        let cluster_id = tx.last_insert_rowid();
        for (rank, (media_id, score)) in draft.members.iter().enumerate() {
            tx.execute(
                "INSERT INTO cluster_members (cluster_id, media_id, rank, score)
                 VALUES (?1, ?2, ?3, ?4)",
                params![cluster_id, media_id, rank as i64, score],
            )?;
        }
    }
    for row in captions {
        tx.execute(
            "INSERT INTO media_captions (media_id, tag, caption, score)
             VALUES (?1, ?2, ?3, ?4)",
            params![row.media_id, row.tag, row.caption, row.score],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub(super) fn read(conn: &Connection) -> Result<ConceptIndex, DbError> {
    let mut cluster_stmt = conn.prepare(
        "SELECT id, kind, label, summary, score, source_id
         FROM clusters
         ORDER BY CASE kind WHEN 'burst' THEN 0 WHEN 'semantic' THEN 1 ELSE 2 END, id ASC",
    )?;
    let mut clusters = cluster_stmt
        .query_map([], |row| {
            Ok(ConceptCluster {
                id: row.get(0)?,
                kind: row.get(1)?,
                label: row.get(2)?,
                summary: row.get(3)?,
                score: row.get(4)?,
                source_id: row.get(5)?,
                media_ids: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(cluster_stmt);

    let mut member_stmt = conn.prepare(
        "SELECT cluster_id, media_id
         FROM cluster_members
         ORDER BY cluster_id, rank ASC, media_id ASC",
    )?;
    let pairs = member_stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(member_stmt);

    let mut by_cluster: HashMap<i64, Vec<i64>> = HashMap::new();
    for (cluster_id, media_id) in pairs {
        by_cluster.entry(cluster_id).or_default().push(media_id);
    }
    for cluster in &mut clusters {
        if let Some(ids) = by_cluster.remove(&cluster.id) {
            cluster.media_ids = ids;
        }
    }

    let mut caption_stmt = conn.prepare(
        "SELECT media_id, tag, caption, score
         FROM media_captions
         ORDER BY score DESC, tag ASC",
    )?;
    let captions = caption_stmt
        .query_map([], |row| {
            Ok(MediaCaption {
                media_id: row.get(0)?,
                tag: row.get(1)?,
                caption: row.get(2)?,
                score: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ConceptIndex { clusters, captions })
}

fn burst_drafts(conn: &Connection) -> Result<Vec<Draft>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, captured_at
         FROM media_files
         WHERE captured_at IS NOT NULL
         ORDER BY captured_at ASC, id ASC",
    )?;
    let shots = stmt
        .query_map([], |row| {
            let path: String = row.get(1)?;
            let folder = parent_folder(&path);
            Ok(Shot {
                id: row.get(0)?,
                place: place_name(&folder),
                folder,
                captured_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut by_folder: HashMap<String, Vec<Shot>> = HashMap::new();
    for shot in shots {
        by_folder.entry(shot.folder.clone()).or_default().push(shot);
    }

    let mut drafts = Vec::new();
    for folder_shots in by_folder.into_values() {
        let mut start = 0;
        while start < folder_shots.len() {
            let mut end = start + 1;
            while end < folder_shots.len()
                && folder_shots[end].captured_at - folder_shots[end - 1].captured_at
                    <= BURST_GAP_SECS
            {
                end += 1;
            }
            if end - start >= 2 {
                let group = &folder_shots[start..end];
                let span = group.last().unwrap().captured_at - group[0].captured_at;
                drafts.push((
                    group[0].captured_at,
                    Draft {
                        kind: "burst",
                        label: format!("{} · {}", group[0].place, clock(group[0].captured_at)),
                        summary: burst_summary(group.len(), span),
                        score: 1.0,
                        source_id: None,
                        members: group.iter().map(|shot| (shot.id, 1.0)).collect(),
                    },
                ));
            }
            start = end;
        }
    }
    drafts.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.label.cmp(&right.1.label))
    });
    Ok(drafts.into_iter().map(|(_, draft)| draft).collect())
}

struct Shot {
    id: i64,
    folder: String,
    place: String,
    captured_at: i64,
}

fn semantic_drafts(conn: &Connection) -> Result<Vec<Draft>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT media_id, label, score FROM media_labels ORDER BY score DESC, media_id ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f32>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut grouped: HashMap<String, Vec<(i64, f32)>> = HashMap::new();
    for (media_id, label, score) in rows {
        let key = label.trim().to_lowercase();
        if key.is_empty() || key == "person" {
            continue;
        }
        let entry = grouped.entry(key).or_default();
        if entry.iter().any(|(id, _)| *id == media_id) {
            continue;
        }
        entry.push((media_id, score));
    }

    let mut drafts: Vec<Draft> = grouped
        .into_iter()
        .map(|(key, members)| {
            let score = members.iter().map(|(_, value)| *value).sum::<f32>() / members.len() as f32;
            Draft {
                kind: "semantic",
                label: title_case(&key),
                summary: frame_summary(members.len()),
                score,
                source_id: None,
                members,
            }
        })
        .collect();
    drafts.sort_by(|left, right| {
        right
            .members
            .len()
            .cmp(&left.members.len())
            .then(right.score.total_cmp(&left.score))
            .then_with(|| left.label.cmp(&right.label))
    });
    Ok(drafts)
}

fn person_drafts(conn: &Connection) -> Result<Vec<Draft>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT people.id, people.name, faces.media_id, faces.confidence
         FROM people
         JOIN faces ON faces.person_id = people.id
         ORDER BY people.id ASC, faces.confidence DESC, faces.media_id ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, f32>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut grouped: HashMap<i64, PersonAcc> = HashMap::new();
    for (id, name, media_id, confidence) in rows {
        let entry = grouped.entry(id).or_insert_with(|| PersonAcc {
            name: name.clone(),
            faces: 0,
            members: Vec::new(),
        });
        entry.faces += 1;
        if entry.name.as_deref().unwrap_or("").trim().is_empty() {
            entry.name = name;
        }
        if let Some(member) = entry
            .members
            .iter_mut()
            .find(|(media, _)| *media == media_id)
        {
            member.1 = member.1.max(confidence);
        } else {
            entry.members.push((media_id, confidence));
        }
    }

    let mut drafts: Vec<Draft> = grouped
        .into_iter()
        .filter(|(_, entry)| !entry.members.is_empty())
        .map(|(id, entry)| {
            let name = entry
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let score = entry.members.iter().map(|(_, value)| *value).sum::<f32>()
                / entry.members.len() as f32;
            Draft {
                kind: "person",
                label: name.unwrap_or_else(|| "Unnamed".to_string()),
                summary: person_summary(entry.faces, entry.members.len()),
                score,
                source_id: Some(id),
                members: entry.members,
            }
        })
        .collect();
    drafts.sort_by(|left, right| {
        right
            .members
            .len()
            .cmp(&left.members.len())
            .then_with(|| left.label.cmp(&right.label))
    });
    Ok(drafts)
}

struct PersonAcc {
    name: Option<String>,
    faces: usize,
    members: Vec<(i64, f32)>,
}

fn caption_rows(conn: &Connection) -> Result<Vec<CaptionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT media_id, label, score
         FROM media_labels
         ORDER BY media_id ASC, score DESC, label ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f32>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut by_media: HashMap<i64, Vec<(String, f32)>> = HashMap::new();
    for (media_id, label, score) in rows {
        let tag = label.trim().to_lowercase();
        if tag.is_empty() {
            continue;
        }
        let entry = by_media.entry(media_id).or_default();
        if entry.iter().any(|(current, _)| current == &tag) {
            continue;
        }
        entry.push((tag, score));
    }

    let mut captions = Vec::new();
    for (media_id, tags) in by_media {
        let sentence = caption_sentence(&tags);
        for (tag, score) in tags {
            captions.push(CaptionRow {
                media_id,
                tag,
                caption: sentence.clone(),
                score,
            });
        }
    }
    Ok(captions)
}

fn caption_sentence(tags: &[(String, f32)]) -> String {
    let words: Vec<String> = tags.iter().map(|(tag, _)| title_case(tag)).collect();
    match words.as_slice() {
        [] => String::new(),
        [only] => only.clone(),
        [first, second] => format!("{first} and {second}"),
        _ => {
            let (head, tail) = words.split_at(words.len() - 1);
            format!("{}, and {}", head.join(", "), tail[0])
        }
    }
}

fn frame_summary(count: usize) -> String {
    if count == 1 {
        "1 frame".to_string()
    } else {
        format!("{count} frames")
    }
}

fn burst_summary(count: usize, span: i64) -> String {
    let frames = frame_summary(count);
    if span < 90 {
        return format!("{frames} · sequence");
    }
    let minutes = span / 60;
    if minutes < 1 {
        return format!("{frames} · sequence");
    }
    format!("{frames} · {minutes} min")
}

fn person_summary(faces: usize, frames: usize) -> String {
    if faces == frames {
        frame_summary(frames)
    } else {
        format!("{faces} faces · {}", frame_summary(frames))
    }
}

fn parent_folder(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(index) if index > 0 => trimmed[..index].to_string(),
        _ => trimmed.to_string(),
    }
}

fn place_name(folder: &str) -> String {
    let name = folder
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or("Library");
    title_case(name)
}

fn clock(captured_at: i64) -> String {
    let day = captured_at.rem_euclid(86_400);
    format!("{:02}:{:02}", day / 3600, (day % 3600) / 60)
}

fn title_case(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut cap = true;
    for ch in value.chars() {
        if ch.is_alphanumeric() {
            if cap {
                out.extend(ch.to_uppercase());
                cap = false;
            } else {
                out.extend(ch.to_lowercase());
            }
        } else {
            out.push(ch);
            cap = true;
        }
    }
    out
}
