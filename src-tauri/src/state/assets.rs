use super::persistence::get_app_data_dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetReference {
    pub asset_hash: String,
    pub local_file_path: String,
}

pub fn get_assets_dir() -> PathBuf {
    get_app_data_dir().join("images")
}

fn extension_from_mime(mime_type: &str) -> &'static str {
    match mime_type.to_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

/// Imports raw image bytes into the content-addressed asset store.
/// Computes SHA-256 hash and writes the file atomically if not already present.
pub fn import_image_bytes(bytes: &[u8], mime_type: &str) -> Result<AssetReference, String> {
    if bytes.is_empty() {
        return Err("Cannot import empty image buffer".into());
    }

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash_bytes = hasher.finalize();
    let asset_hash = format!("{:x}", hash_bytes);

    let ext = extension_from_mime(mime_type);
    let filename = format!("{}.{}", asset_hash, ext);

    let assets_dir = get_assets_dir();
    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create asset directory {:?}: {}", assets_dir, e))?;

    let target_path = assets_dir.join(&filename);
    let local_file_path = target_path.to_string_lossy().to_string();

    if !target_path.exists() {
        let temp_path = assets_dir.join(format!("{}.tmp.{}", asset_hash, std::process::id()));
        fs::write(&temp_path, bytes)
            .map_err(|e| format!("Failed to write temporary image asset {:?}: {}", temp_path, e))?;

        fs::rename(&temp_path, &target_path).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("Failed to rename temporary asset to {:?}: {}", target_path, e)
        })?;
        info!("Saved new image asset to {:?}", target_path);
    } else {
        info!("Reusing existing deduplicated image asset {:?}", target_path);
    }

    Ok(AssetReference {
        asset_hash,
        local_file_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_asset_dedup_by_hash() {
        let sample_bytes = b"DESKTOP_CANVAS_TEST_IMAGE_BYTES_12345";
        let mime = "image/png";

        let ref1 = import_image_bytes(sample_bytes, mime).expect("First import failed");
        let ref2 = import_image_bytes(sample_bytes, mime).expect("Second import failed");

        assert_eq!(ref1.asset_hash, ref2.asset_hash);
        assert_eq!(ref1.local_file_path, ref2.local_file_path);
        assert!(std::path::Path::new(&ref1.local_file_path).exists());
    }
}
