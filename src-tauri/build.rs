fn main() {
    tauri_build::build();

    // ort's static ONNX Runtime was built with Objective-C `@available` checks.
    // Those lower to `___isPlatformVersionAtLeast` in clang's compiler-rt.
    // rustc links with `-nodefaultlibs`, so pull that archive in explicitly
    // when targeting macOS.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_clang_rt_osx();
    }
}

fn link_clang_rt_osx() {
    let output = std::process::Command::new("clang")
        .arg("--print-resource-dir")
        .output()
        .expect("run `clang --print-resource-dir` to locate libclang_rt.osx.a");
    assert!(
        output.status.success(),
        "`clang --print-resource-dir` failed; cannot locate libclang_rt.osx.a"
    );
    let resource_dir = String::from_utf8(output.stdout).expect("clang resource dir is UTF-8");
    let darwin_dir = std::path::Path::new(resource_dir.trim()).join("lib/darwin");
    let archive = darwin_dir.join("libclang_rt.osx.a");
    assert!(
        archive.exists(),
        "libclang_rt.osx.a not found in {}",
        darwin_dir.display()
    );
    println!("cargo:rustc-link-search=native={}", darwin_dir.display());
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}
