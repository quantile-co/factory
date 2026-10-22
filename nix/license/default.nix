{ lib, ... }:
{
  options.quantile-co.factory.license = {
    mitFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/license/MIT;
      description = "MIT license template; select explicitly and customize copyright metadata only.";
    };
    proprietaryFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/license/PROPRIETARY;
      description = "Proprietary license template; select explicitly without changing its legal terms.";
    };
    noticeFile = lib.mkOption {
      type = lib.types.path;
      default = ../../etc/license/NOTICE.md;
      description = "Quantile notice template; preserve repository-specific third-party notices.";
    };
  };
}
