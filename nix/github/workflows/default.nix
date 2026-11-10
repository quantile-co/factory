{
  config,
  lib,
  ...
}:
let
  cfg = config.quantile-co.factory.github.workflows;
  indent =
    spaces: value:
    lib.concatMapStrings (
      line: (if line == "" then "" else lib.concatStrings (lib.replicate spaces " ") + line) + "\n"
    ) (lib.splitString "\n" (lib.removeSuffix "\n" value));
  script = path: indent 10 (builtins.readFile path);
  cachixSetup = indent 6 ''
    - name: Set up Cachix
      uses: cachix/cachix-action@38b082610b782e7e93e209c35fd730d399dee866 # v17
      with:
        name: ''${{ github.repository_owner }}
        authToken: ''${{ secrets.CACHIX_AUTH_TOKEN }}
        useDaemon: false
  '';
  namespaceSetup =
    indent 6 ''
      - name: Set up Namespace Nix cache
        env:
          NIX_CACHE_PUBLIC_KEY: ''${{ vars.NIX_CACHE_PUBLIC_KEY }}
        run: |
    ''
    + script ../../../etc/github/workflows/nixcache-setup.sh;
  namespaceFinish =
    "\n"
    + indent 6 ''
      - name: Publish Namespace Nix cache
        if: success() && github.ref == 'refs/heads/main'
        env:
          NIX_CACHE_PRIVATE_KEY: ''${{ secrets.NIX_CACHE_PRIVATE_KEY }}
          NIX_CACHE_PUBLIC_KEY: ''${{ vars.NIX_CACHE_PUBLIC_KEY }}
        run: |
    ''
    + script ../../../etc/github/workflows/nixcache-publish.sh
    + "\n"
    + indent 6 ''
      - name: Stop Namespace Nix cache
        if: always()
        run: |
          if [ -f "$RUNNER_TEMP/nixcache.pid" ]; then
            kill -TERM "$(cat "$RUNNER_TEMP/nixcache.pid")"
          fi
    '';
  cacheJob =
    source:
    if cfg.nixCache == "cachix" then
      source
    else
      assert lib.assertMsg (lib.hasInfix cachixSetup source) "Workflow Cachix setup changed";
      builtins.replaceStrings [ cachixSetup ] [ namespaceSetup ] source + namespaceFinish;
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
    builtins.toFile name (
      selectedHeader
      + "\njobs:\n"
      + lib.concatStringsSep "\n" (map (layer: cacheJob jobs.${layer}) layers)
    );
in
{
  options.quantile-co.factory.github.workflows = {
    nixCache = lib.mkOption {
      type = lib.types.enum [
        "cachix"
        "namespace"
      ];
      default = "cachix";
      description = "Remote Nix cache for trusted main jobs; Check retains volume/public-cache reads only.";
    };
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
      default = builtins.toFile "test.yaml" (
        cacheJob (builtins.readFile ../../../etc/github/workflows/test.yaml)
      );
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
