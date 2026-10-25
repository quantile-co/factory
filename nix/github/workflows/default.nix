{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.quantile-co.factory.github.workflows;
  render =
    name: source: layers:
    let
      # Select the two native job blocks without reserializing the YAML layout.
      parts = lib.splitString "\njobs:\n" (builtins.readFile source);
      sections = lib.splitString "\n  application:\n" (builtins.elemAt parts 1);
      jobs = {
        infrastructure = builtins.head sections;
        application = "  application:\n" + builtins.elemAt sections 1;
      };
      choices = "          - infrastructure\n          - application\n";
      header = builtins.head parts;
      selectedHeader =
        builtins.replaceStrings
          [ "        default: infrastructure\n" choices ]
          [
            "        default: ${builtins.head layers}\n"
            (lib.concatMapStrings (layer: "          - ${layer}\n") layers)
          ]
          header;
    in
    assert lib.assertMsg (
      layers != [ ] && lib.length layers == lib.length (lib.unique layers)
    ) "Select distinct workflow layers.";
    assert lib.assertMsg (
      lib.length parts == 2
      && lib.length sections == 2
      && lib.hasInfix choices header
      && lib.hasInfix "        default: infrastructure\n" header
    ) "Workflow template sections changed.";
    pkgs.writeText name (
      selectedHeader + "\njobs:\n" + lib.concatStringsSep "\n" (map (layer: jobs.${layer}) layers)
    );
in
{
  options.quantile-co.factory.github.workflows = {
    layers = lib.mkOption {
      type = lib.types.listOf (
        lib.types.enum [
          "infrastructure"
          "application"
        ]
      );
      default = [
        "infrastructure"
        "application"
      ];
      description = "Default jobs offered by Build/Plan/Apply; each dispatch selects exactly one layer.";
    };
    check.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../../etc/github/workflows/check.yaml;
      description = "Check workflow.";
    };
    test.configFile = lib.mkOption {
      type = lib.types.path;
      default = ../../../etc/github/workflows/test.yaml;
      description = "Test workflow.";
    };
    build.layers = lib.mkOption {
      type = lib.types.listOf (
        lib.types.enum [
          "infrastructure"
          "application"
        ]
      );
      default = cfg.layers;
      description = "Build jobs when artifact layers differ from deployment layers.";
    };
    build.configFile = lib.mkOption {
      type = lib.types.path;
      default = render "build.yaml" ../../../etc/github/workflows/build.yaml cfg.build.layers;
      description = "Build workflow.";
    };
    plan.configFile = lib.mkOption {
      type = lib.types.path;
      default = render "plan.yaml" ../../../etc/github/workflows/plan.yaml cfg.layers;
      description = "Plan workflow.";
    };
    apply.configFile = lib.mkOption {
      type = lib.types.path;
      default = render "apply.yaml" ../../../etc/github/workflows/apply.yaml cfg.layers;
      description = "Apply workflow.";
    };
  };
}
