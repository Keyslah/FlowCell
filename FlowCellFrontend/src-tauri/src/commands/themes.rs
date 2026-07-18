use crate::*;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SampledPhotoThemeColors {
    headers_hex: String,
    text_hex: String,
    scene_hex: String,
    controls_hex: String,
    misc_hex: String,
    highlights_hex: String,
    palette_hexes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedBlenderThemeFile {
    format: String,
    saved_at: String,
    values: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SampleRgb {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Default)]
pub(crate) struct ColorBucketStats {
    count: u32,
    r_sum: u64,
    g_sum: u64,
    b_sum: u64,
}

#[derive(Clone, Copy)]
pub(crate) struct PaletteCandidate {
    color: SampleRgb,
    count: u32,
}

fn rgb_to_hex(color: SampleRgb) -> String {
    format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b)
}

fn srgb_channel_to_linear(value: u8) -> f64 {
    let normalized = f64::from(value) / 255.0;
    if normalized <= 0.04045 {
        normalized / 12.92
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4)
    }
}

fn relative_luminance(color: SampleRgb) -> f64 {
    0.2126 * srgb_channel_to_linear(color.r)
        + 0.7152 * srgb_channel_to_linear(color.g)
        + 0.0722 * srgb_channel_to_linear(color.b)
}

fn contrast_ratio(left: SampleRgb, right: SampleRgb) -> f64 {
    let left_luma = relative_luminance(left);
    let right_luma = relative_luminance(right);
    let (lighter, darker) = if left_luma >= right_luma {
        (left_luma, right_luma)
    } else {
        (right_luma, left_luma)
    };
    (lighter + 0.05) / (darker + 0.05)
}

fn color_distance_sq(left: SampleRgb, right: SampleRgb) -> u32 {
    let dr = i32::from(left.r) - i32::from(right.r);
    let dg = i32::from(left.g) - i32::from(right.g);
    let db = i32::from(left.b) - i32::from(right.b);
    (dr * dr + dg * dg + db * db) as u32
}

fn color_saturation(color: SampleRgb) -> f64 {
    let red = f64::from(color.r) / 255.0;
    let green = f64::from(color.g) / 255.0;
    let blue = f64::from(color.b) / 255.0;
    let max_value = red.max(green).max(blue);
    let min_value = red.min(green).min(blue);
    if max_value <= 0.0 {
        0.0
    } else {
        (max_value - min_value) / max_value
    }
}

fn color_hue_degrees(color: SampleRgb) -> Option<f64> {
    let red = f64::from(color.r) / 255.0;
    let green = f64::from(color.g) / 255.0;
    let blue = f64::from(color.b) / 255.0;
    let max_value = red.max(green).max(blue);
    let min_value = red.min(green).min(blue);
    let delta = max_value - min_value;
    if delta <= 0.0001 || max_value <= 0.0 {
        return None;
    }

    let hue = if (max_value - red).abs() <= f64::EPSILON {
        60.0 * ((green - blue) / delta).rem_euclid(6.0)
    } else if (max_value - green).abs() <= f64::EPSILON {
        60.0 * (((blue - red) / delta) + 2.0)
    } else {
        60.0 * (((red - green) / delta) + 4.0)
    };
    Some(hue)
}

fn hue_distance_degrees(left: f64, right: f64) -> f64 {
    let distance = (left - right).abs().rem_euclid(360.0);
    distance.min(360.0 - distance)
}

fn select_hue_diverse_candidates(
    candidates: &[PaletteCandidate],
    target_len: usize,
) -> Vec<PaletteCandidate> {
    let mut selected = Vec::<PaletteCandidate>::new();
    if candidates.is_empty() {
        return selected;
    }

    let first = candidates
        .iter()
        .copied()
        .max_by(|left, right| {
            let score = |candidate: PaletteCandidate| {
                let saturation = color_saturation(candidate.color);
                let luminance = relative_luminance(candidate.color);
                saturation * 120.0 + f64::from(candidate.count.max(1)).ln() * 3.0
                    - (luminance - 0.45).abs() * 20.0
            };
            score(*left)
                .partial_cmp(&score(*right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(candidates[0]);
    selected.push(first);

    while selected.len() < target_len && selected.len() < candidates.len() {
        let next = candidates
            .iter()
            .copied()
            .filter(|candidate| {
                !selected
                    .iter()
                    .any(|existing| existing.color == candidate.color)
            })
            .max_by(|left, right| {
                let score = |candidate: PaletteCandidate| {
                    let min_rgb_distance = selected
                        .iter()
                        .map(|existing| {
                            f64::from(color_distance_sq(candidate.color, existing.color)).sqrt()
                        })
                        .fold(f64::INFINITY, f64::min);
                    let hue = color_hue_degrees(candidate.color);
                    let min_hue_distance = hue
                        .map(|candidate_hue| {
                            selected
                                .iter()
                                .filter_map(|existing| {
                                    color_hue_degrees(existing.color).map(|existing_hue| {
                                        hue_distance_degrees(candidate_hue, existing_hue)
                                    })
                                })
                                .fold(180.0, f64::min)
                        })
                        .unwrap_or(0.0);
                    let saturation = color_saturation(candidate.color);
                    let luminance = relative_luminance(candidate.color);
                    min_hue_distance * 2.2
                        + min_rgb_distance * 0.85
                        + saturation * 75.0
                        + f64::from(candidate.count.max(1)).ln() * 3.0
                        - (luminance - 0.48).abs() * 12.0
                };
                score(*left)
                    .partial_cmp(&score(*right))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

        if let Some(candidate) = next {
            selected.push(candidate);
        } else {
            break;
        }
    }

    selected
}

fn pick_sampled_highlight_color(
    candidates: &[PaletteCandidate],
    scene_color: SampleRgb,
    controls_color: SampleRgb,
) -> SampleRgb {
    candidates
        .iter()
        .copied()
        .max_by(|left, right| {
            let score = |candidate: PaletteCandidate| {
                let saturation = color_saturation(candidate.color);
                let contrast = contrast_ratio(candidate.color, scene_color);
                let luminance = relative_luminance(candidate.color);
                let scene_distance =
                    f64::from(color_distance_sq(candidate.color, scene_color)).sqrt();
                let distance_bonus = (scene_distance / 255.0).min(1.0) * 20.0;
                let count_bonus = f64::from(candidate.count.max(1)).ln() * 2.0;
                saturation * 150.0
                    + contrast * 10.0
                    + luminance * 18.0
                    + distance_bonus
                    + count_bonus
            };
            score(*left)
                .partial_cmp(&score(*right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|candidate| candidate.color)
        .unwrap_or(controls_color)
}

fn quantize_channel(value: u8) -> u8 {
    value / 24
}

fn resolve_sampled_text_color(text_color: SampleRgb, background_color: SampleRgb) -> SampleRgb {
    if contrast_ratio(text_color, background_color) >= 4.5 {
        return text_color;
    }
    let black = SampleRgb {
        r: 12,
        g: 12,
        b: 12,
    };
    let white = SampleRgb {
        r: 244,
        g: 244,
        b: 244,
    };
    if contrast_ratio(black, background_color) >= contrast_ratio(white, background_color) {
        black
    } else {
        white
    }
}

fn fill_palette_to_five(colors: &mut Vec<SampleRgb>) {
    let fallbacks = [
        SampleRgb {
            r: 32,
            g: 32,
            b: 32,
        },
        SampleRgb {
            r: 240,
            g: 240,
            b: 240,
        },
        SampleRgb {
            r: 96,
            g: 96,
            b: 96,
        },
    ];
    let seed = colors.first().copied().unwrap_or(fallbacks[0]);
    while colors.len() < 5 {
        let next = fallbacks
            .get(colors.len().saturating_sub(1))
            .copied()
            .unwrap_or(seed);
        colors.push(next);
    }
}

fn pick_photo_theme_colors(path: &Path) -> Result<SampledPhotoThemeColors, String> {
    if !path.is_file() {
        return Err(format!("Image file was not found: {}", path.display()));
    }

    let image = image::open(path).map_err(|error| format!("Unable to read image: {error}"))?;
    let resized = image.resize(160, 160, FilterType::Triangle).to_rgba8();
    let mut buckets: HashMap<(u8, u8, u8), ColorBucketStats> = HashMap::new();

    for pixel in resized.pixels() {
        if pixel[3] < 24 {
            continue;
        }
        let key = (
            quantize_channel(pixel[0]),
            quantize_channel(pixel[1]),
            quantize_channel(pixel[2]),
        );
        let entry = buckets.entry(key).or_default();
        entry.count += 1;
        entry.r_sum += u64::from(pixel[0]);
        entry.g_sum += u64::from(pixel[1]);
        entry.b_sum += u64::from(pixel[2]);
    }

    if buckets.is_empty() {
        return Err("Image did not contain enough readable opaque pixels.".to_string());
    }

    let mut candidates = buckets
        .into_iter()
        .filter_map(|(_key, bucket)| {
            (bucket.count > 0).then_some(PaletteCandidate {
                color: SampleRgb {
                    r: (bucket.r_sum / u64::from(bucket.count)) as u8,
                    g: (bucket.g_sum / u64::from(bucket.count)) as u8,
                    b: (bucket.b_sum / u64::from(bucket.count)) as u8,
                },
                count: bucket.count,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.count.cmp(&left.count));

    let mut distance_distinct = Vec::<PaletteCandidate>::new();
    for threshold in [42_u32, 28_u32, 18_u32, 0_u32] {
        for candidate in &candidates {
            if distance_distinct
                .iter()
                .any(|existing| existing.color == candidate.color)
            {
                continue;
            }
            if distance_distinct.iter().all(|existing| {
                color_distance_sq(existing.color, candidate.color) >= threshold * threshold
            }) {
                distance_distinct.push(*candidate);
            }
            if distance_distinct.len() >= 24 {
                break;
            }
        }
        if distance_distinct.len() >= 12 {
            break;
        }
    }

    let distinct = select_hue_diverse_candidates(&distance_distinct, 16);
    if distinct.is_empty() {
        return Err("Image sampling did not produce a usable palette.".to_string());
    }

    let palette_hexes = distinct
        .iter()
        .map(|candidate| rgb_to_hex(candidate.color))
        .collect::<Vec<_>>();
    let highlight_candidates = distinct.clone();
    let mut available = distinct;
    let scene_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_luma = relative_luminance(left.color);
            let right_luma = relative_luminance(right.color);
            let left_score = f64::from(left.count) - ((left_luma - 0.45).abs() * 120.0);
            let right_score = f64::from(right.count) - ((right_luma - 0.45).abs() * 120.0);
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let scene_color = available.remove(scene_index).color;

    let text_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            contrast_ratio(left.color, scene_color)
                .partial_cmp(&contrast_ratio(right.color, scene_color))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let text_color = if available.is_empty() {
        resolve_sampled_text_color(scene_color, scene_color)
    } else {
        resolve_sampled_text_color(available.remove(text_index).color, scene_color)
    };

    let controls_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_score = color_saturation(left.color) * 100.0 + f64::from(left.count) * 0.01;
            let right_score = color_saturation(right.color) * 100.0 + f64::from(right.count) * 0.01;
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let controls_color = if available.is_empty() {
        scene_color
    } else {
        available.remove(controls_index).color
    };

    let headers_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_score = f64::from(left.count) + contrast_ratio(left.color, scene_color) * 10.0;
            let right_score =
                f64::from(right.count) + contrast_ratio(right.color, scene_color) * 10.0;
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let headers_color = if available.is_empty() {
        controls_color
    } else {
        available.remove(headers_index).color
    };

    let misc_color = available
        .first()
        .map(|candidate| candidate.color)
        .unwrap_or(headers_color);
    let highlights_color =
        pick_sampled_highlight_color(&highlight_candidates, scene_color, controls_color);

    let mut palette = vec![
        headers_color,
        text_color,
        scene_color,
        controls_color,
        misc_color,
    ];
    fill_palette_to_five(&mut palette);

    Ok(SampledPhotoThemeColors {
        headers_hex: rgb_to_hex(palette[0]),
        text_hex: rgb_to_hex(palette[1]),
        scene_hex: rgb_to_hex(palette[2]),
        controls_hex: rgb_to_hex(palette[3]),
        misc_hex: rgb_to_hex(palette[4]),
        highlights_hex: rgb_to_hex(highlights_color),
        palette_hexes,
    })
}

fn sanitize_theme_file_stem(value: &str) -> String {
    let trimmed = value.trim();
    let mut sanitized = String::with_capacity(trimmed.len());
    let mut last_was_separator = false;
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() {
            sanitized.push(character);
            last_was_separator = false;
            continue;
        }
        if matches!(character, ' ' | '-' | '_' | '.') && !last_was_separator {
            sanitized.push('_');
            last_was_separator = true;
        }
    }
    let cleaned = sanitized.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "blender_theme".to_string()
    } else {
        cleaned
    }
}

fn normalize_theme_file_path(path: &Path) -> PathBuf {
    if path.extension().is_some() {
        path.to_path_buf()
    } else {
        let mut next_path = path.to_path_buf();
        next_path.set_extension("json");
        next_path
    }
}

fn resolve_default_blender_theme_root() -> Result<PathBuf, String> {
    let root = resolve_flowcell_local_root()?.join("blender_themes");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "Failed to create Blender theme folder at {}: {error}",
            root.display()
        )
    })?;
    Ok(root)
}

#[tauri::command]
pub(crate) fn sample_photo_theme_colors(
    image_path: String,
) -> Result<SampledPhotoThemeColors, String> {
    let trimmed_path = image_path.trim();
    if trimmed_path.is_empty() {
        return Err("Image path is required.".to_string());
    }

    pick_photo_theme_colors(Path::new(trimmed_path))
}

#[tauri::command]
pub(crate) fn sample_image_palette(image_path: String) -> Result<SampledPhotoThemeColors, String> {
    sample_photo_theme_colors(image_path)
}

#[tauri::command]
pub(crate) fn save_blender_theme_file(
    suggested_name: String,
    path: Option<String>,
    values: Value,
) -> Result<String, String> {
    let file_path = if let Some(raw_path) = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        normalize_theme_file_path(Path::new(raw_path))
    } else {
        let theme_root = resolve_default_blender_theme_root()?;
        theme_root.join(format!(
            "{}.json",
            sanitize_theme_file_stem(&suggested_name)
        ))
    };

    if let Some(parent) = file_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create Blender theme folder at {}: {error}",
                    parent.display()
                )
            })?;
        }
    }

    let payload = SavedBlenderThemeFile {
        format: "flowcell-blender-theme-v1".to_string(),
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs()
            .to_string(),
        values,
    };
    let serialized = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&file_path, serialized).map_err(|error| {
        format!(
            "Failed to write Blender theme file at {}: {error}",
            file_path.display()
        )
    })?;

    Ok(file_path.display().to_string())
}

#[tauri::command]
pub(crate) fn load_blender_theme_file(path: String) -> Result<Value, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Blender theme file path is required.".to_string());
    }

    let file_path = PathBuf::from(trimmed_path);
    if !file_path.is_file() {
        return Err(format!(
            "Blender theme file was not found: {}",
            file_path.display()
        ));
    }

    let raw = fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "Failed to read Blender theme file at {}: {error}",
            file_path.display()
        )
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Failed to parse Blender theme file at {}: {error}",
            file_path.display()
        )
    })?;
    let values = parsed.get("values").cloned().unwrap_or(parsed);
    if !values.is_object() {
        return Err("Blender theme file did not contain a valid theme object.".to_string());
    }

    Ok(values)
}
