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
  cachixSetup = indent 6 ''
    - name: Set up Cachix
      uses: cachix/cachix-action@38b082610b782e7e93e209c35fd730d399dee866 # v17
      with:
        name: ''${{ github.repository_owner }}
        authToken: ''${{ secrets.CACHIX_AUTH_TOKEN }}
        useDaemon: false
  '';
  cacheJob =
    source:
    let
      marker = lib.findFirst (value: lib.hasInfix value source) null (
        map (name: "      - name: ${name}\n        env:\n") [
          "Build"
          "Plan"
          "Apply"
          "Run checks, then tests"
        ]
      );
    in
    if cfg.nixCache == "cachix" then
      source
    else
      assert lib.assertMsg (lib.hasInfix cachixSetup source) "Workflow Cachix setup changed";
      assert lib.assertMsg (marker != null) "Workflow task environment changed";
      builtins.replaceStrings
        [
          cachixSetup
          marker
          "nix build --no-link --print-out-paths"
          "\"$direnv\" allow ."
          "\"$direnv\" exec . pnpm install --frozen-lockfile"
        ]
        [
          ""
          (
            marker
            + "          NIX_CACHE_PROVIDER: namespace\n"
            + "          NIX_CACHE_PUBLIC_KEY: \${{ vars.NIX_CACHE_PUBLIC_KEY }}\n"
            + "          NIX_CACHE_PRIVATE_KEY: \${{ secrets.NIX_CACHE_PRIVATE_KEY }}\n"
          )
          "env -u NIX_CACHE_PRIVATE_KEY nix build --no-link --print-out-paths"
          "env -u NIX_CACHE_PRIVATE_KEY \"$direnv\" allow ."
          "env -u NIX_CACHE_PRIVATE_KEY \"$direnv\" exec . pnpm install --frozen-lockfile"
        ]
        source;
  collectorJob =
    phase: source:
    if !(builtins.elem phase cfg.otelJobs) then
      source
    else
      let
        task =
          {
            test = "Run checks, then tests";
            build = "Build";
            plan = "Plan";
            apply = "Apply";
          }
          .${phase};
        marker = "      - name: ${task}\n        env:\n";
      in
      assert lib.assertMsg (lib.hasInfix marker source) "Workflow task environment changed";
      builtins.replaceStrings
        [ marker "        run: |\n" "\"$direnv\" exec . pnpm run github:" ]
        [
          (
            marker
            + "          OTEL_AGENT_PLATFORM: namespace\n"
            + "          OTEL_AGENT_REPOSITORY: \${{ github.repository }}\n"
            + "          OTEL_AGENT_RUN_ID: \${{ github.run_id }}\n"
            + "          OTEL_AGENT_RUN_ATTEMPT: \${{ github.run_attempt }}\n"
            + "          CLICKSTACK_OTLP_ENDPOINT: \${{ vars.CLICKSTACK_OTLP_ENDPOINT }}\n"
            + "          CLICKSTACK_API_KEY: \${{ secrets.CLICKSTACK_API_KEY }}\n"
          )
          # Shell-local until shell evaluation and frozen install have finished.
          "        run: |\n          export -n CLICKSTACK_OTLP_ENDPOINT CLICKSTACK_API_KEY\n"
          "shell=$(env -u NIX_CACHE_PRIVATE_KEY \"$direnv\" export bash)\n          eval \"$shell\"\n          unset shell\n          export CLICKSTACK_OTLP_ENDPOINT CLICKSTACK_API_KEY\n          pnpm otel -- pnpm run github:"
        ]
        source;
  hindsightJob =
    phase: source:
    if
      !cfg.hindsight
      || !(builtins.elem phase [
        "plan"
        "apply"
      ])
    then
      source
    else
      let
        marker = "          GH_REPO_TOKEN: \${{ secrets.GH_REPO_TOKEN }}\n";
      in
      assert lib.assertMsg (lib.hasInfix marker source)
        "Workflow provider credential environment changed";
      builtins.replaceStrings
        [ marker ]
        [ (marker + "          HINDSIGHT_API_TOKEN: \${{ secrets.HINDSIGHT_API_TOKEN }}\n") ]
        source;
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
      + lib.concatStringsSep "\n" (
        map (
          layer:
          let
            phase = lib.removeSuffix ".yaml" name;
          in
          hindsightJob phase (collectorJob phase (cacheJob jobs.${layer}))
        ) layers
      )
    );
in
{
  options.quantile-co.factory.github.workflows = {
    hindsight = lib.mkEnableOption "the Hindsight runtime credential in protected Plan/Apply jobs";
    otelJobs = lib.mkOption {
      type = lib.types.listOf (
        lib.types.enum [
          "test"
          "build"
          "plan"
          "apply"
        ]
      );
      default = [ ];
      description = "Explicit ClickHouse Observability jobs, only protected workflow_dispatch main jobs, never Check/PRs. Caller supplies pnpm otel and selected native collector/config paths.";
    };
    nixCache = lib.mkOption {
      type = lib.types.enum [
        "cachix"
        "namespace"
      ];
      default = "cachix";
      description = "Remote cache for trusted main jobs; GitHub TypeScript commands orchestrate Namespace after dependency installation. Check keeps volume/public reads.";
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
        collectorJob "test" (cacheJob (builtins.readFile ../../../etc/github/workflows/test.yaml))
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
