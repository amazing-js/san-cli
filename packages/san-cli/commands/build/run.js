/**
 * @file build run
 * @author wangyongqing <wangyongqing01@baidu.com>
 */

const {info, error, chalk, success: successLog} = require('../../lib/ttyLogger');
const fse = require('fs-extra');

// 合并 config 的方式
const modifyConfig = (config, fn) => {
    if (Array.isArray(config)) {
        config.forEach(c => fn(c));
    } else {
        fn(config);
    }
};
module.exports = (command, desc, builder) =>
    function apply(api, projectOptions) {
        const handler = async argv => {
            // 开始时间
            const startTime = Date.now();
            const mode = argv.mode || process.env.NODE_ENV || 'production'; // 默认是 production
            // 重新赋值
            argv.mode = mode;

            const {watch, analyze, verbose, dest} = argv;
            info(`Building for ${mode}...`);

            // 获取 webpack 配置
            const config = getNormalizeWebpackConfig(api, projectOptions, argv);

            // require sth..
            const path = require('path');

            /**
             * 失败处理逻辑
             * @param {Error|Stats} err - error 对象
             */
            function fail({err, stats}) {
                if (stats && stats.toJson) {
                    console.log('Build failed with errors.');
                    process.stderr.write(
                        stats.toString({
                            colors: !!argv.colors || !!argv.color,
                            children: false,
                            modules: false,
                            chunkModules: false
                        })
                    );
                } else {
                    console.log(err);
                }
                process.exit(1);
            }
            // 编译成功处理逻辑
            function success({stats: webpackStats}) {
                if (!analyze) {
                    // 只有在非 analyze 模式下才会输出 log
                    const targetDir = api.resolve(config.output.path || dest || projectOptions.outputDir);
                    const targetDirShort = path.relative(api.getCwd(), targetDir);
                    const stats = webpackStats.toJson({
                        all: false,
                        entrypoints: true,
                        assets: true,
                        chunks: true,
                        version: true,
                        timings: true,
                        performance: true
                    });

                    if (verbose) {
                        argv.stats = 'verbose';
                    }
                    if (argv.stats === 'table') {
                        //  TODO：这里有问题，需要调试下 hulk 的 report 代码
                        console.log(
                            require('../../lib/report')(stats, targetDirShort, {
                                resolve: p => api.resolve(p)
                            })
                        );
                    } else {
                        const Stats = require('webpack/lib/Stats');
                        const statsOptions = Stats.presetToOptions(argv.stats);
                        statsOptions.colors = !!argv.colors || !!argv.color;
                        console.log(webpackStats.toString(statsOptions));
                    }
                    if (!watch) {
                        const duration = (Date.now() - startTime) / 1e3;

                        const {time, version} = stats;
                        successLog(
                            `The ${chalk.cyan(targetDirShort)} directory is ready to be deployed. Duration ${chalk.cyan(
                                `${duration}/${time / 1e3}s`
                            )}, Webpack ${version}.`
                        );
                    }
                }
                if (watch) {
                    successLog('Build complete. Watching for changes...');
                }
            }

            // 放到这里 require 是让命令行更快加载，而不是等 webpack 这大坨东西。。
            const build = require('../../webpack/build');
            build({webpackConfig: config, success, fail});
        };

        // 注册命令
        api.registerCommand(command, {
            builder,
            desc,
            handler
        });
    };

function getNormalizeWebpackConfig(api, projectOptions, argv) {
    const {mode, entry, dest, analyze, watch, clean, remote, report} = argv;
    // const isProduction = mode ? mode === 'production' : process.env.NODE_ENV === 'production';

    if (remote) {
        const DeployPlugin = require('deploy-files');
        // TODO 从 env 读取？
    }

    const targetDir = api.resolve(dest || projectOptions.outputDir);

    if (clean) {
        fse.removeSync(targetDir);
    }

    const chainConfig = api.resolveChainableWebpackConfig();

    if (analyze) {
        // 添加 analyze
        const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');
        chainConfig.plugin('bundle-analyzer').use(new BundleAnalyzerPlugin());
    } else if (report || argv['report-json']) {
        const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');
        // 单独标示 modern 打包
        const bundleName = '';
        chainConfig.plugin('bundle-analyzer').use(
            new BundleAnalyzerPlugin({
                logLevel: 'warn',
                openAnalyzer: false,
                analyzerMode: report ? 'static' : 'disabled',
                reportFilename: `${bundleName}report.html`,
                statsFilename: `${bundleName}report.json`,
                generateStatsFile: !!argv['report-json']
            })
        );
    }

    // resolve webpack config
    const webpackConfig = api.resolveWebpackConfig(chainConfig);

    if (dest) {
        modifyConfig(webpackConfig, config => {
            config.output.path = targetDir;
        });
    }

    // --watch 功能
    if (watch) {
        modifyConfig(webpackConfig, config => {
            config.watch = true;
        });
    }

    webpackConfig.mode = mode;

    if (entry) {
        if (/\.san$/.test(entry)) {
            webpackConfig.resolve.alias['~entry'] = api.resolve(entry);
        } else {
            webpackConfig.entry = {
                app: entry
            };
        }
        // 默认san.config page 里面配置的就有 app 呢？
    } else if (entry && !projectOptions.pages) {
        webpackConfig.entry = {app: api.resolve(entry)};
        // 默认san.config page 里面配置的就有 app 呢？
        // delete webpackConfig.entry.app;
    }

    // 处理 entry 不存在的情况
    if (
        /* eslint-disable operator-linebreak */
        !webpackConfig.entry ||
        /* eslint-enable operator-linebreak */
        (!Array.isArray(webpackConfig.entry) && Object.keys(webpackConfig.entry).length === 0)
    ) {
        error('没有找到 Entry，请命令后面添加 entry 或者配置 san.config.js');
        process.exit(1);
    }

    return webpackConfig;
}