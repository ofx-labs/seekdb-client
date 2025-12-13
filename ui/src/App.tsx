import { useState, useEffect, useCallback } from "react";
import DatabaseConnections from "./components/DatabaseConnections/index";

const App = () => {
  const [currentOpenView, setCurrentOpenView] = useState(
    "showDatabaseConnections"
  );

  // 初始化时
  useEffect(() => {
    // 应用VS Code深色主题设置
    applyVSCodeTheme();

    // 添加消息监听
    const messageListener = (event: MessageEvent) => {
      const message = event.data;
      console.log("App接收到消息:", message, new Date().toISOString());

      // 处理从扩展发送过来的状态消息
      if (
        message.type === "openDatabase" ||
        message.type === "updateDatabaseConnections"
      ) {
        // 显示数据库连接列表
        console.log("收到显示数据库连接列表消息");
        setCurrentOpenView("showDatabaseConnections");
      }
    };

    window.addEventListener("message", messageListener);

    return () => {
      window.removeEventListener("message", messageListener);
    };
  }, []);

  // 应用VS Code主题
  const applyVSCodeTheme = () => {
    // 默认应用深色主题
    document.documentElement.classList.add("vscode-dark-theme");

    // 获取VS Code的实际主题颜色变量
    try {
      // 尝试读取VS Code提供的主题颜色（如果在VS Code环境中）
      const computedStyle = getComputedStyle(document.documentElement);
      const bgColor = computedStyle.getPropertyValue(
        "--vscode-editor-background"
      );

      if (bgColor && bgColor.trim()) {
        console.log("检测到VS Code环境，使用VS Code提供的主题颜色");
      }
    } catch (error) {
      console.log("无法获取VS Code主题变量，使用默认深色主题", error);
    }
  };

  // 定义要显示的主要内容
  const renderMainContent = useCallback(() => {
    console.log("渲染主要内容, 当前视图:", currentOpenView);

    // 确保渲染的组件有唯一的key，强制在切换时重新创建实例
    switch (currentOpenView) {
      case "showDatabaseConnections":
        return <DatabaseConnections key="database-connections-component" />;
      default:
        return (
          <DatabaseConnections key="database-connections-default-component" />
        );
    }
  }, [currentOpenView]);

  return (
    <div className="app-container">
      {/* 渲染主要内容 */}
      {renderMainContent()}

      {/* 添加一些基本样式 */}
      <style>{`
        .app-container {
          display: flex;
          flex-direction: column;
          padding-bottom: 1rem;
          max-width: 100%;
          overflow: hidden;
          position: relative;
          height: 100vh;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
        }

        /* 全局样式覆盖，适配VSCode风格 */
        :global(body) {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
        }

        :global(button) {
          font-family: inherit;
          cursor: pointer;
        }

        :global(input, textarea, select) {
          font-family: inherit;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 2px;
        }

        :global(input:focus, textarea:focus, select:focus) {
          outline: 1px solid var(--vscode-focusBorder);
          border-color: var(--vscode-focusBorder);
        }

        :global(a) {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }

        :global(a:hover) {
          text-decoration: underline;
          color: var(--vscode-textLink-activeForeground);
        }

        :global(*::-webkit-scrollbar) {
          width: 8px;
          height: 8px;
        }

        :global(*::-webkit-scrollbar-track) {
          background: var(--vscode-scrollbarSlider-background);
        }

        :global(*::-webkit-scrollbar-thumb) {
          background: var(--vscode-scrollbarSlider-hoverBackground);
          border-radius: 4px;
        }

        :global(*::-webkit-scrollbar-thumb:hover) {
          background: var(--vscode-scrollbarSlider-activeBackground);
        }
      `}</style>
    </div>
  );
};

export default App;
