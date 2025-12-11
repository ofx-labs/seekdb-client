// 每次执行 watch 命令，都会重新执行 build 命令， 并且会监听 src 目录下的文件变化，一旦发生变化，就会重新执行 build 命令
const chokidar = require("chokidar");
const path = require("path");
const { execSync } = require("child_process");
const chalk = require("react-dev-utils/chalk");

console.log(chalk.cyan("Starting watch mode...\n"));
console.log(chalk.yellow("Initial build in progress...\n"));

// 执行初始构建
try {
  require("./build");
  console.log(chalk.green("\nInitial build completed successfully.\n"));
} catch (error) {
  console.error(chalk.red("\nInitial build failed:"), error);
  process.exit(1);
}

// 监视 src 目录下的文件变化
const watcher = chokidar.watch(path.resolve(__dirname, "../src"), {
  ignored: /(^|[\/\\])\../, // 忽略以点开头的文件
  persistent: true,
});

console.log(chalk.cyan("Watching for changes in src directory...\n"));

// 防抖函数，避免频繁构建
let buildTimeout = null;
const debouncedBuild = () => {
  if (buildTimeout) {
    clearTimeout(buildTimeout);
  }
  buildTimeout = setTimeout(() => {
    console.log(chalk.yellow("\nFile change detected. Starting build...\n"));
    try {
      require("./build");
      console.log(chalk.green("\nBuild completed successfully.\n"));
    } catch (error) {
      console.error(chalk.red("\nBuild failed:"), error);
    }
  }, 500);
};

// 监听所有文件变化事件
watcher
  .on("change", (path) => {
    console.log(chalk.blue(`File ${path} has been changed`));
    debouncedBuild();
  })
  .on("add", (path) => {
    console.log(chalk.green(`File ${path} has been added`));
    debouncedBuild();
  })
  .on("unlink", (path) => {
    console.log(chalk.red(`File ${path} has been removed`));
    debouncedBuild();
  });

console.log(chalk.cyan("Watch mode is running. Press Ctrl+C to stop.\n"));
