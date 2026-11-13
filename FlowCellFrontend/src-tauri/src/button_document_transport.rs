use serde_json::{json, Value};
use std::collections::HashMap;

const TRANSPORT_MARKER: &str = "__flowcellButtonDocumentTransport";
const LARGE_STRING_BYTES: usize = 4096;

/// Deduplicate large strings for IPC only. Canonical documents remain complete on disk.
pub(crate) fn pack_button_document(mut document: Value) -> Value {
    if !document.is_object() {
        return document;
    }
    fn visit(
        value: &mut Value,
        path: &mut Vec<String>,
        indexes: &mut HashMap<String, usize>,
        strings: &mut Vec<String>,
        references: &mut Vec<(Vec<String>, usize)>,
    ) {
        match value {
            Value::String(source) if source.len() >= LARGE_STRING_BYTES => {
                let index = if let Some(index) = indexes.get(source.as_str()) {
                    *index
                } else {
                    let index = strings.len();
                    indexes.insert(source.clone(), index);
                    strings.push(std::mem::take(source));
                    index
                };
                *value = Value::Null;
                references.push((path.clone(), index));
            }
            Value::Object(object) => {
                for (key, child) in object {
                    path.push(key.clone());
                    visit(child, path, indexes, strings, references);
                    path.pop();
                }
            }
            Value::Array(array) => {
                for (index, child) in array.iter_mut().enumerate() {
                    path.push(index.to_string());
                    visit(child, path, indexes, strings, references);
                    path.pop();
                }
            }
            _ => {}
        }
    }

    let mut strings = Vec::new();
    let mut references = Vec::new();
    visit(
        &mut document,
        &mut Vec::new(),
        &mut HashMap::new(),
        &mut strings,
        &mut references,
    );
    if references.is_empty() {
        return document;
    }
    json!({
        TRANSPORT_MARKER: 1,
        "document": document,
        "strings": strings,
        "references": references,
    })
}

/// Restore the full document before validation, revision checks, or persistence.
pub(crate) fn unpack_button_document(value: Value) -> Result<Value, String> {
    if !value
        .as_object()
        .is_some_and(|object| object.contains_key(TRANSPORT_MARKER))
    {
        return Ok(value);
    }
    let Value::Object(mut envelope) = value else {
        unreachable!("transport marker requires an object")
    };
    if envelope.len() != 4
        || envelope.get(TRANSPORT_MARKER).and_then(Value::as_u64) != Some(1)
        || !envelope.get("document").is_some_and(Value::is_object)
        || !envelope.contains_key("strings")
        || !envelope.contains_key("references")
    {
        return Err("Button document transport envelope has an invalid version or shape.".into());
    }
    let strings = envelope
        .remove("strings")
        .expect("transport strings were checked");
    let strings = strings
        .as_array()
        .ok_or("Button document transport strings must be an array.")?;
    if strings.iter().any(|entry| !entry.is_string()) {
        return Err("Button document transport strings must contain only strings.".into());
    }
    let references = envelope
        .remove("references")
        .expect("transport references were checked");
    let references = references
        .as_array()
        .ok_or("Button document transport references must be an array.")?;
    let mut document = envelope
        .remove("document")
        .expect("transport document was checked");

    for reference in references {
        let pair = reference
            .as_array()
            .filter(|pair| pair.len() == 2)
            .ok_or("Button document transport reference must be a path/index pair.")?;
        let path = pair[0]
            .as_array()
            .ok_or("Button document transport reference path must be an array.")?;
        if path.is_empty() {
            return Err("Button document transport reference path must not be empty.".into());
        }
        let index = pair[1]
            .as_u64()
            .and_then(|index| usize::try_from(index).ok())
            .ok_or("Button document transport string index must be a nonnegative integer.")?;
        let source = strings
            .get(index)
            .ok_or("Button document transport string index is out of range.")?;
        let mut target = &mut document;
        for segment in path {
            let segment = segment
                .as_str()
                .ok_or("Button document transport path segments must be strings.")?;
            target = match target {
                Value::Object(object) => object.get_mut(segment),
                Value::Array(array) => segment
                    .parse::<usize>()
                    .ok()
                    .filter(|index| index.to_string() == segment)
                    .and_then(|index| array.get_mut(index)),
                _ => None,
            }
            .ok_or("Button document transport path does not exist.")?;
        }
        if !target.is_null() {
            return Err(
                "Button document transport references must point to distinct null placeholders."
                    .into(),
            );
        }
        *target = source.clone();
    }
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_preserves_repeated_unique_unicode_and_literal_keys() {
        let repeated = "repeated payload ".repeat(400);
        let unicode = "🦊".repeat(1024);
        let document = json!({
            "revision": 13,
            "skins": {"first": repeated, "second": repeated, "unicode": unicode},
            "nested": [null, {"__proto__": repeated, "constructor": [unicode]}],
            "null": null,
            "small": "kept inline",
            "number": 1.25,
            "boolean": false,
        });
        let packed = pack_button_document(document.clone());
        assert_eq!(packed[TRANSPORT_MARKER], 1);
        assert_eq!(packed["strings"].as_array().unwrap().len(), 2);
        assert_eq!(packed["references"].as_array().unwrap().len(), 5);
        assert_eq!(packed["document"]["nested"][0], Value::Null);
        assert_eq!(packed["document"]["small"], "kept inline");
        assert_eq!(unpack_button_document(packed).unwrap(), document);
    }

    #[test]
    fn strings_are_packed_at_the_utf8_byte_threshold_but_keys_are_not() {
        let long_key = "k".repeat(4096);
        let document = json!({
            long_key.clone(): "short",
            "below": "a".repeat(4095),
            "threshold": "a".repeat(4096),
            "unicodeBelow": "é".repeat(2047),
            "unicodeThreshold": "é".repeat(2048),
        });
        let packed = pack_button_document(document.clone());
        assert_eq!(packed["strings"].as_array().unwrap().len(), 2);
        assert_eq!(packed["document"][&long_key], "short");
        assert!(packed["document"]["below"].is_string());
        assert!(packed["document"]["unicodeBelow"].is_string());
        assert_eq!(unpack_button_document(packed).unwrap(), document);
    }

    #[test]
    fn raw_json_and_nested_marker_fields_are_unchanged() {
        for raw in [
            Value::Null,
            json!([1, "two", null]),
            json!({"revision": 7}),
            json!({"nested": {TRANSPORT_MARKER: 1, "ordinary": true}}),
        ] {
            assert_eq!(pack_button_document(raw.clone()), raw);
            assert_eq!(unpack_button_document(raw.clone()).unwrap(), raw);
        }
    }

    #[test]
    fn non_document_roots_are_not_packed() {
        for value in [json!("root".repeat(2048)), json!(["array".repeat(2048)])] {
            assert_eq!(pack_button_document(value.clone()), value);
            assert_eq!(unpack_button_document(value.clone()).unwrap(), value);
        }
    }

    #[test]
    fn malformed_envelopes_fail_before_a_document_can_be_committed() {
        let base = json!({TRANSPORT_MARKER: 1, "document": {"a": [null], "taken": "value"},
            "strings": ["restored"], "references": [[["a", "0"], 0]]});
        for invalid in [
            json!([["a", "0"]]),
            json!(["a", 0]),
            json!([["a", 0], 0]),
            json!([[], 0]),
            json!([["a", "-1"], 0]),
            json!([["a", "01"], 0]),
            json!([["a", "1"], 0]),
            json!([["missing"], 0]),
            json!([["taken"], 0]),
            json!([["a", "0"], -1]),
            json!([["a", "0"], 0.5]),
            json!([["a", "0"], 1]),
        ] {
            let mut envelope = base.clone();
            envelope["references"] = json!([invalid]);
            assert!(
                unpack_button_document(envelope).is_err(),
                "accepted malformed reference"
            );
        }
        for (key, invalid) in [
            ("strings", json!({})),
            ("strings", json!([null])),
            ("references", json!({})),
        ] {
            let mut envelope = base.clone();
            envelope[key] = invalid;
            assert!(unpack_button_document(envelope).is_err());
        }
        let mut duplicate = base;
        duplicate["references"] = json!([[["a", "0"], 0], [["a", "0"], 0]]);
        assert!(unpack_button_document(duplicate).is_err());
        for envelope in [
            json!({TRANSPORT_MARKER: 1}),
            json!({TRANSPORT_MARKER: 2, "document": {}, "strings": [], "references": []}),
            json!({TRANSPORT_MARKER: 1, "document": null, "strings": [], "references": []}),
            json!({TRANSPORT_MARKER: 1, "document": [], "strings": [], "references": []}),
            json!({TRANSPORT_MARKER: 1, "document": {}, "strings": [], "references": [], "extra": true}),
        ] {
            assert!(unpack_button_document(envelope).is_err());
        }
    }

    #[test]
    fn javascript_wire_fixture_decodes_literal_object_keys_and_array_indexes() {
        let wire = r#"{"__flowcellButtonDocumentTransport":1,"document":{"__proto__":{"value":null},"array":[null,null],"revision":9},"strings":["shared","unique"],"references":[[["__proto__","value"],0],[["array","0"],0],[["array","1"],1]]}"#;
        let restored = unpack_button_document(serde_json::from_str(wire).unwrap()).unwrap();
        assert_eq!(
            restored,
            json!({"__proto__":{"value":"shared"},"array":["shared","unique"],"revision":9})
        );
    }

    #[test]
    #[ignore = "Read-only benchmark requires FLOWCELL_TRANSPORT_BENCHMARK_PATH"]
    fn current_profile_transport_benchmark() {
        use std::time::Instant;
        let path = std::env::var("FLOWCELL_TRANSPORT_BENCHMARK_PATH")
            .expect("explicit benchmark path required");
        let start = Instant::now();
        let raw = std::fs::read(path).unwrap();
        let read_ms = start.elapsed().as_millis();
        let start = Instant::now();
        let document: Value = serde_json::from_slice(&raw).unwrap();
        let parse_ms = start.elapsed().as_millis();
        let start = Instant::now();
        let packed = pack_button_document(document);
        let pack_ms = start.elapsed().as_millis();
        let start = Instant::now();
        let wire = serde_json::to_vec(&packed).unwrap();
        let serialize_ms = start.elapsed().as_millis();
        let string_count = packed["strings"].as_array().map_or(0, Vec::len);
        let reference_count = packed["references"].as_array().map_or(0, Vec::len);
        let start = Instant::now();
        let restored = unpack_button_document(packed).unwrap();
        let unpack_ms = start.elapsed().as_millis();
        assert!(
            restored == serde_json::from_slice::<Value>(&raw).unwrap(),
            "transport roundtrip changed the profile"
        );
        println!("profile_transport input_bytes={} wire_bytes={} strings={} references={} read_ms={} parse_ms={} pack_ms={} serialize_ms={} unpack_ms={}",
            raw.len(), wire.len(), string_count, reference_count, read_ms, parse_ms, pack_ms, serialize_ms, unpack_ms);
    }
}
