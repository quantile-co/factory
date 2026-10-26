{ lib, pkgs, ... }:
{
  options.quantile-co.factory.uv.shellHook = lib.mkOption {
    type = lib.types.lines;
    default = ''
      export UV_PYTHON="${pkgs.python3}/bin/python3"
      export UV_PYTHON_DOWNLOADS=never
    ''
    + lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
      export LD_LIBRARY_PATH="${
        lib.makeLibraryPath [
          pkgs.stdenv.cc.cc.lib
          pkgs.zlib
        ]
      }''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    '';
    description = "Opt-in pinned Python and Linux binary-wheel runtime for uv; dependencies remain explicitly installed.";
  };
}
