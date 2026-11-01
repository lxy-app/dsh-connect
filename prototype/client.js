window.__ModuleLoader__.load({
  id: '@local/dsh-connect-prototype',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;
    const PANEL = 'dsh-connect-prototype';

    const DICTS = {
      zh: {
        appName: 'DSH Connect', prototype: '高保真原型', mobile: '移动 App', admin: '管理后台',
        demo: '交互演示 · 模拟数据', sessions: '会话', tasks: '待办', devices: '设备', profile: '我的',
        overview: '概览', users: '用户与角色', policies: '访问策略', running: '运行与会话',
        approvals: '审批策略', audit: '审计日志', settings: '系统设置', search: '搜索会话',
        all: '全部', active: '运行中', pending: '待处理', finished: '已完成', newSession: '新建会话',
        online: '在线', offline: '离线', send: '发送', cancel: '取消执行', allow: '允许一次',
        reject: '拒绝', back: '返回', create: '创建并发送', view: '查看会话', revoke: '解除配对',
        save: '保存更改', export: '导出日志', invite: '邀请用户', live: '实时会话',
        pendingApprovals: '待审批', activeDevices: '在线桌面', todayCommands: '今日远程指令',
        failedTasks: '异常任务', recent: '最近动态', weekly: '近 7 日远程推进',
        notification: '通知设置', biometric: '生物识别', privacy: '隐私与安全', server: '服务器',
        general: '通用', roles: '角色权限', device: '设备', workspace: '工作区', status: '状态',
        operator: '操作者', action: '操作', time: '时间', result: '结果', more: '查看全部',
      },
      en: {
        appName: 'DSH Connect', prototype: 'Hi-fi Prototype', mobile: 'Mobile App', admin: 'Admin Console',
        demo: 'Interactive demo · Mock data', sessions: 'Sessions', tasks: 'Tasks', devices: 'Devices', profile: 'Profile',
        overview: 'Overview', users: 'Users & Roles', policies: 'Access Policies', running: 'Runs & Sessions',
        approvals: 'Approval Policies', audit: 'Audit Logs', settings: 'System Settings', search: 'Search sessions',
        all: 'All', active: 'Running', pending: 'Pending', finished: 'Finished', newSession: 'New Session',
        online: 'Online', offline: 'Offline', send: 'Send', cancel: 'Cancel run', allow: 'Allow once',
        reject: 'Reject', back: 'Back', create: 'Create & Send', view: 'View session', revoke: 'Unpair',
        save: 'Save changes', export: 'Export logs', invite: 'Invite user', live: 'Live sessions',
        pendingApprovals: 'Pending approvals', activeDevices: 'Online desktops', todayCommands: 'Commands today',
        failedTasks: 'Failed tasks', recent: 'Recent activity', weekly: 'Remote progress · 7 days',
        notification: 'Notifications', biometric: 'Biometric unlock', privacy: 'Privacy & Security', server: 'Server',
        general: 'General', roles: 'Role permissions', device: 'Device', workspace: 'Workspace', status: 'Status',
        operator: 'Operator', action: 'Action', time: 'Time', result: 'Result', more: 'View all',
      },
    };

    const CSS = `
      .dc-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;overflow:hidden}
      .dc-root *{box-sizing:border-box}.dc-root button,.dc-root input,.dc-root textarea,.dc-root select{font:inherit}.dc-root button{cursor:pointer}.dc-root button:disabled{cursor:not-allowed;opacity:.45}
      .dc-topbar{height:66px;flex:0 0 66px;display:flex;align-items:center;gap:18px;padding:0 22px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);z-index:2}
      .dc-brand{display:flex;align-items:center;gap:10px;min-width:235px}.dc-brand-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,var(--dsw-alias-bg-layer-1))}
      .dc-brand-title{font-weight:700;font-size:15px;letter-spacing:-.2px}.dc-brand-sub{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
      .dc-switch{display:flex;padding:3px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);gap:2px}.dc-switch button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:7px 15px;display:flex;align-items:center;gap:7px}.dc-switch button.dc-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 4px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
      .dc-demo{margin-left:auto;display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px}.dc-demo-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
      .dc-icon-btn{width:34px;height:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);display:grid;place-items:center}.dc-icon-btn:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
      .dc-mobile-stage{flex:1;min-height:0;display:flex;justify-content:center;align-items:flex-start;gap:30px;overflow:auto;padding:26px;background:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--dsw-alias-border-l2) 65%,transparent) 1px,transparent 0);background-size:22px 22px}
      .dc-phone-wrap{flex:0 0 auto;padding:4px 0 18px}.dc-phone{width:390px;height:760px;position:relative;overflow:hidden;border:7px solid var(--dsw-alias-label-primary);border-radius:45px;background:var(--dsw-alias-bg-base);box-shadow:0 26px 70px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);display:flex;flex-direction:column}
      .dc-phone-status{height:34px;flex:0 0 34px;display:flex;align-items:center;justify-content:space-between;padding:0 23px;font-size:11px;font-weight:650;position:relative;background:var(--dsw-alias-bg-base)}.dc-notch{position:absolute;left:50%;top:5px;transform:translateX(-50%);width:102px;height:23px;border-radius:20px;background:var(--dsw-alias-label-primary)}
      .dc-phone-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.dc-phone-scroll{flex:1;min-height:0;overflow:auto;padding:0 16px 18px}.dc-phone-nav{height:67px;flex:0 0 67px;display:flex;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);padding:6px 10px 12px}
      .dc-phone-nav button{flex:1;border:0;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10px;position:relative}.dc-phone-nav button.dc-on{color:var(--dsw-alias-brand-primary)}.dc-nav-badge{position:absolute;top:2px;left:54%;min-width:15px;height:15px;border-radius:8px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-layer-1);font-size:9px;display:grid;place-items:center}
      .dc-mobile-head{display:flex;align-items:center;justify-content:space-between;padding:12px 0 15px}.dc-mobile-title{font-size:26px;font-weight:750;letter-spacing:-.8px}.dc-mobile-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px}.dc-avatar{width:35px;height:35px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary);font-weight:750;font-size:12px}
      .dc-device-pill{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:14px;margin-bottom:12px}.dc-device-pill .dc-grow{flex:1}.dc-device-name{font-weight:650;font-size:12px}.dc-device-meta{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:2px}
      .dc-search{height:39px;display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:0 11px;color:var(--dsw-alias-label-secondary)}.dc-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary)}.dc-search input::placeholder{color:var(--dsw-alias-label-secondary)}
      .dc-chips{display:flex;gap:7px;padding:12px 0;overflow:auto}.dc-chip{border:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:9px;padding:6px 12px;font-size:11px;white-space:nowrap}.dc-chip.dc-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary);font-weight:650}
      .dc-session-list{display:flex;flex-direction:column;gap:10px}.dc-session-card{width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:16px;padding:13px;color:var(--dsw-alias-label-primary);transition:.15s}.dc-session-card:hover{transform:translateY(-1px);border-color:var(--dsw-alias-brand-primary)}.dc-session-top{display:flex;align-items:flex-start;gap:8px}.dc-session-title{font-size:13px;font-weight:680;line-height:1.4;flex:1}.dc-session-preview{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);margin:7px 0 10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.dc-session-foot{display:flex;align-items:center;justify-content:space-between;color:var(--dsw-alias-label-secondary);font-size:10px}
      .dc-badge{display:inline-flex;align-items:center;gap:5px;border-radius:7px;padding:3px 7px;font-size:10px;white-space:nowrap;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dc-badge:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}.dc-badge.dc-success{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,var(--dsw-alias-bg-layer-1))}.dc-badge.dc-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 11%,var(--dsw-alias-bg-layer-1))}.dc-badge.dc-error{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1))}.dc-badge.dc-brand{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,var(--dsw-alias-bg-layer-1))}
      .dc-fab{width:44px;height:44px;border:0;border-radius:15px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);display:grid;place-items:center;box-shadow:0 7px 18px color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent)}
      .dc-guide{width:282px;flex:0 0 282px;display:flex;flex-direction:column;gap:14px}.dc-guide-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:18px;padding:18px}.dc-guide-kicker{font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:var(--dsw-alias-brand-primary);font-weight:750}.dc-guide-title{font-size:20px;line-height:1.3;font-weight:750;letter-spacing:-.4px;margin:8px 0}.dc-guide-copy{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
      .dc-guide-list{display:flex;flex-direction:column;gap:5px;margin-top:12px}.dc-guide-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:0;border-radius:11px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left}.dc-guide-item:hover,.dc-guide-item.dc-on{background:var(--dsw-alias-bg-layer-2)}.dc-guide-item .dc-num{width:23px;height:23px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);display:grid;place-items:center;font-size:10px;color:var(--dsw-alias-label-secondary)}.dc-guide-item.dc-on .dc-num{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}
      .dc-flow{display:flex;gap:10px;align-items:flex-start;padding:9px 0}.dc-flow-line{width:24px;display:flex;flex-direction:column;align-items:center;align-self:stretch}.dc-flow-dot{width:22px;height:22px;flex:0 0 22px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary)}.dc-flow-line:after{content:"";width:1px;flex:1;background:var(--dsw-alias-border-l1);margin:4px 0}.dc-flow:last-child .dc-flow-line:after{display:none}.dc-flow-title{font-size:12px;font-weight:650}.dc-flow-copy{font-size:10px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:3px}
      .dc-chat-head{display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.dc-chat-title{flex:1;min-width:0}.dc-chat-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-chat-state{font-size:10px;color:var(--dsw-alias-state-success-primary);margin-top:3px}.dc-chat-messages{flex:1;min-height:0;overflow:auto;padding:16px 14px}.dc-date{text-align:center;color:var(--dsw-alias-label-secondary);font-size:9px;margin-bottom:15px}.dc-message{display:flex;margin-bottom:13px}.dc-message.dc-user{justify-content:flex-end}.dc-bubble{max-width:86%;padding:10px 12px;border-radius:7px 15px 15px 15px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.65}.dc-user .dc-bubble{border:0;border-radius:15px 7px 15px 15px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,var(--dsw-alias-bg-layer-1))}.dc-message-time{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:5px}
      .dc-tool-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:11px;margin:0 0 13px}.dc-tool-head{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:650}.dc-tool-icon{width:27px;height:27px;border-radius:8px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}.dc-code{font-family:"SFMono-Regular",Consolas,monospace;font-size:10px;line-height:1.65;background:var(--dsw-alias-bg-layer-2);border-radius:9px;padding:9px;margin-top:9px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
      .dc-composer{padding:10px 12px 16px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.dc-compose-box{border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:9px 9px 7px;background:var(--dsw-alias-bg-base)}.dc-compose-box textarea{width:100%;height:40px;resize:none;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5}.dc-compose-actions{display:flex;align-items:center;justify-content:space-between}.dc-compose-mode{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;padding:4px}.dc-send{width:30px;height:30px;border:0;border-radius:10px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);display:grid;place-items:center}.dc-stop{width:100%;margin-top:8px;border:0;background:transparent;color:var(--dsw-alias-state-error-primary);font-size:10px}
      .dc-approval-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:16px;padding:14px;margin-bottom:11px}.dc-approval-top{display:flex;align-items:center;gap:9px}.dc-risk{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 11%,var(--dsw-alias-bg-layer-1))}.dc-approval-title{font-size:13px;font-weight:680}.dc-approval-sub{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:3px}.dc-approval-body{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:12px 0}.dc-btn{min-height:34px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 12px;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-weight:600;font-size:11px}.dc-btn:hover{border-color:var(--dsw-alias-brand-primary)}.dc-btn.dc-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}.dc-btn.dc-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1))}.dc-btn.dc-ghost{background:transparent;border-color:transparent}.dc-button-row{display:flex;gap:8px}.dc-button-row>.dc-btn{flex:1}
      .dc-detail-head{display:flex;align-items:center;gap:10px;padding:10px 0 15px}.dc-detail-title{font-size:17px;font-weight:720;flex:1}.dc-section-label{font-size:10px;font-weight:700;letter-spacing:.6px;color:var(--dsw-alias-label-secondary);margin:17px 0 8px;text-transform:uppercase}.dc-info-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:12px}.dc-info-row{display:flex;justify-content:space-between;gap:16px;padding:7px 0;font-size:11px}.dc-info-row span:first-child{color:var(--dsw-alias-label-secondary)}.dc-info-row span:last-child{text-align:right;font-weight:550}.dc-warning{border-radius:12px;padding:11px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-warn-primary);font-size:10px;line-height:1.6;margin:12px 0}
      .dc-device-card{width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:16px;padding:14px;margin-bottom:11px;color:var(--dsw-alias-label-primary)}.dc-device-hero{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary)}.dc-device-row{display:flex;align-items:center;gap:11px}.dc-device-row .dc-grow{flex:1}.dc-progress{height:5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:9px}.dc-progress span{display:block;height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary)}
      .dc-settings-group{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:15px;margin-bottom:14px;overflow:hidden}.dc-setting-row{display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);min-height:52px}.dc-setting-row:last-child{border-bottom:0}.dc-setting-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}.dc-setting-text{flex:1;font-size:12px}.dc-setting-sub{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:3px}.dc-toggle{width:37px;height:22px;padding:2px;border:0;border-radius:20px;background:var(--dsw-alias-border-l2);display:flex;align-items:center;transition:.15s}.dc-toggle span{width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);transition:.15s}.dc-toggle.dc-on{background:var(--dsw-alias-brand-primary)}.dc-toggle.dc-on span{transform:translateX(15px)}
      .dc-field{margin-bottom:13px}.dc-field label{display:block;font-size:11px;font-weight:600;margin-bottom:6px}.dc-input,.dc-select,.dc-textarea{width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:10px 11px;outline:0}.dc-input:focus,.dc-select:focus,.dc-textarea:focus{border-color:var(--dsw-alias-brand-primary)}.dc-textarea{min-height:92px;resize:none;line-height:1.6}
      .dc-sheet-layer{position:absolute;inset:0;z-index:20;background:color-mix(in srgb,var(--dsw-alias-label-primary) 35%,transparent);display:flex;align-items:flex-end}.dc-sheet{width:100%;background:var(--dsw-alias-bg-overlay);border-radius:24px 24px 38px 38px;padding:10px 20px 25px;box-shadow:0 -15px 50px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}.dc-sheet-handle{width:38px;height:4px;border-radius:4px;background:var(--dsw-alias-border-l2);margin:0 auto 18px}.dc-sheet-icon{width:54px;height:54px;border-radius:18px;display:grid;place-items:center;margin:3px auto 13px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary)}.dc-sheet-title{text-align:center;font-size:18px;font-weight:730}.dc-sheet-copy{text-align:center;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.7;margin:8px 0 19px}
      .dc-admin-wrap{flex:1;min-height:0;overflow:auto;padding:20px;background:var(--dsw-alias-bg-base)}.dc-admin{height:100%;min-height:710px;display:flex;border:1px solid var(--dsw-alias-border-l1);border-radius:19px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);box-shadow:0 15px 45px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
      .dc-admin-side{width:210px;flex:0 0 210px;background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;padding:18px 12px}.dc-admin-brand{display:flex;align-items:center;gap:10px;padding:0 8px 22px}.dc-admin-brand-name{font-size:14px;font-weight:750}.dc-admin-brand-sub{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:2px;letter-spacing:.8px}.dc-admin-nav{display:flex;flex-direction:column;gap:4px}.dc-admin-nav button{height:39px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:10px;padding:0 11px;text-align:left}.dc-admin-nav button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dc-admin-nav button.dc-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary);font-weight:650}.dc-admin-nav .dc-nav-count{margin-left:auto;font-size:9px;padding:2px 6px;border-radius:6px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-layer-1)}.dc-admin-user{margin-top:auto;display:flex;align-items:center;gap:9px;border-top:1px solid var(--dsw-alias-border-l1);padding:16px 7px 2px}.dc-admin-user-name{font-size:11px;font-weight:650}.dc-admin-user-role{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:2px}
      .dc-admin-main{flex:1;min-width:0;display:flex;flex-direction:column}.dc-admin-head{height:68px;flex:0 0 68px;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:14px;padding:0 24px}.dc-admin-title{font-size:18px;font-weight:720}.dc-admin-head .dc-search{width:230px;height:35px;margin-left:auto}.dc-env{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);padding:6px 9px;border-radius:8px}.dc-admin-content{flex:1;min-height:0;overflow:auto;padding:23px;background:var(--dsw-alias-bg-base)}
      .dc-page-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:19px;gap:15px}.dc-page-title{font-size:20px;font-weight:730;letter-spacing:-.4px}.dc-page-copy{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:5px;line-height:1.5}.dc-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:16px}.dc-metric{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:15px}.dc-metric-top{display:flex;align-items:center;justify-content:space-between;color:var(--dsw-alias-label-secondary);font-size:10px}.dc-metric-icon{width:29px;height:29px;border-radius:9px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}.dc-metric-value{font-size:25px;font-weight:740;letter-spacing:-.8px;margin:10px 0 4px}.dc-metric-delta{font-size:9px;color:var(--dsw-alias-state-success-primary)}.dc-metric-delta.dc-down{color:var(--dsw-alias-state-error-primary)}
      .dc-grid-main{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(240px,.8fr);gap:16px}.dc-panel{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:14px;overflow:hidden}.dc-panel-pad{padding:16px}.dc-panel-head{display:flex;align-items:center;justify-content:space-between;padding:15px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dc-panel-title{font-size:12px;font-weight:680}.dc-panel-link{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:10px}.dc-chart{height:175px;padding:18px 16px 10px;display:flex;align-items:flex-end;gap:10px;position:relative}.dc-chart:before,.dc-chart:after{content:"";position:absolute;left:16px;right:16px;border-top:1px dashed var(--dsw-alias-border-l1)}.dc-chart:before{top:45px}.dc-chart:after{top:100px}.dc-bar-group{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:7px;z-index:1}.dc-bar{width:70%;max-width:30px;border-radius:5px 5px 2px 2px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,var(--dsw-alias-bg-layer-1));transition:.15s}.dc-bar-group.dc-on .dc-bar{background:var(--dsw-alias-brand-primary)}.dc-bar-label{font-size:8px;color:var(--dsw-alias-label-secondary)}
      .dc-table-wrap{overflow:auto}.dc-table{width:100%;border-collapse:collapse;white-space:nowrap}.dc-table th{text-align:left;font-size:9px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);padding:10px 13px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dc-table td{padding:11px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:10px}.dc-table tr:last-child td{border-bottom:0}.dc-table tbody tr:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 3%,var(--dsw-alias-bg-layer-1))}.dc-cell-title{font-size:11px;font-weight:620}.dc-cell-sub{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:3px}.dc-cell-user{display:flex;align-items:center;gap:8px}.dc-mini-avatar{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:700;font-size:9px}.dc-row-action{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:10px;padding:3px}.dc-row-action.dc-danger{color:var(--dsw-alias-state-error-primary)}
      .dc-activity{padding:5px 16px 12px}.dc-activity-item{display:flex;gap:9px;padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dc-activity-item:last-child{border:0}.dc-activity-dot{width:26px;height:26px;flex:0 0 26px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);display:grid;place-items:center;color:var(--dsw-alias-brand-primary)}.dc-activity-title{font-size:10px;line-height:1.5}.dc-activity-time{font-size:8px;color:var(--dsw-alias-label-secondary);margin-top:3px}.dc-quick{padding:14px 16px}.dc-quick-item{display:flex;align-items:center;gap:8px;margin-bottom:12px}.dc-quick-item:last-child{margin:0}.dc-quick-copy{flex:1;min-width:0}.dc-quick-title{font-size:10px;font-weight:620}.dc-quick-sub{font-size:8px;color:var(--dsw-alias-label-secondary);margin-top:3px}
      .dc-filterbar{display:flex;align-items:center;gap:10px;margin-bottom:14px}.dc-filterbar .dc-search{width:260px;height:35px}.dc-filterbar .dc-chips{padding:0}.dc-filterbar .dc-btn{margin-left:auto}.dc-policy-grid{display:grid;grid-template-columns:230px minmax(0,1fr);gap:15px}.dc-policy-list{padding:8px}.dc-policy-item{width:100%;text-align:left;border:0;background:transparent;color:var(--dsw-alias-label-primary);padding:12px;border-radius:10px}.dc-policy-item.dc-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1))}.dc-policy-name{font-size:11px;font-weight:650}.dc-policy-desc{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:4px}.dc-check{width:16px;height:16px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);display:inline-grid;place-items:center;color:transparent}.dc-check.dc-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}
      .dc-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.dc-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dc-admin-content .dc-setting-row{padding:10px 0}.dc-admin-content .dc-settings-group{border:0;background:transparent;border-radius:0;margin:0}.dc-toast{position:absolute;left:50%;bottom:23px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 10px 35px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);border-radius:12px;padding:11px 16px;font-size:11px;animation:dc-in .18s ease-out;white-space:nowrap}.dc-toast svg{color:var(--dsw-alias-state-success-primary)}@keyframes dc-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
      /* Latest mobile navigation, voice input and cloud TTS */
      .dc-compose-box.dc-voice-compose{display:flex;align-items:flex-end;gap:8px;padding:7px;border-radius:22px}.dc-voice-compose textarea{flex:1;min-width:0;height:36px;min-height:36px;max-height:88px;padding:8px 2px;line-height:20px}.dc-voice-switch{width:36px;height:36px;flex:0 0 36px;border:0;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dc-voice-switch:hover,.dc-voice-switch.dc-on{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1))}.dc-voice-compose .dc-send{width:36px;height:36px;flex:0 0 36px;border-radius:50%}.dc-hold-talk{height:36px;flex:1;min-width:0;border:0;border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:650;display:flex;align-items:center;justify-content:center;gap:8px;touch-action:none;user-select:none}.dc-hold-talk:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary)}.dc-hold-talk.dc-listening{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}.dc-compose-hint{text-align:center;font-size:9px;color:var(--dsw-alias-label-secondary);padding-top:7px}.dc-voice-feedback{padding:12px 13px;margin-bottom:8px;border:1px solid var(--dsw-alias-brand-primary);border-radius:17px;background:var(--dsw-alias-bg-layer-1)}.dc-voice-feedback.dc-processing{border-color:var(--dsw-alias-border-l1)}.dc-voice-status{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:650}.dc-voice-time{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:10px;font-variant-numeric:tabular-nums}.dc-recording-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-error-primary);animation:dcVoicePulse 1.2s infinite}.dc-voice-wave{height:25px;display:flex;align-items:center;justify-content:center;gap:3px;margin:8px 0 5px;color:var(--dsw-alias-brand-primary)}.dc-voice-wave i{display:block;width:3px;height:6px;border-radius:3px;background:currentColor;animation:dcVoiceWave .8s ease-in-out infinite alternate;animation-delay:calc(var(--i)*-.09s)}.dc-voice-wave i:nth-child(3n){height:15px}.dc-voice-wave i:nth-child(2n){height:10px}.dc-voice-transcript{min-height:17px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);text-align:center}@keyframes dcVoiceWave{to{height:22px}}@keyframes dcVoicePulse{50%{opacity:.35}}.dc-message.dc-assistant{flex-direction:column;align-items:flex-start}.dc-message-tts{margin:5px 0 0 4px;padding:3px 7px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:4px;font-size:9px}.dc-message-tts:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
      .dc-drawer-layer{position:absolute;inset:34px 0 0;z-index:24;display:flex;overflow:hidden}.dc-drawer-backdrop{position:absolute;inset:0;border:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 38%,transparent);backdrop-filter:blur(2px)}.dc-session-drawer{position:relative;width:324px;max-width:86%;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l1);box-shadow:18px 0 45px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);animation:dcDrawerIn .2s ease-out}.dc-drawer-device-wrap{position:relative;padding:15px 14px 9px}.dc-drawer-device{width:100%;display:flex;align-items:center;gap:10px;padding:7px 5px;border:0;border-radius:11px;background:transparent;text-align:left;color:var(--dsw-alias-label-primary)}.dc-drawer-device:hover{background:var(--dsw-alias-bg-layer-2)}.dc-drawer-device-icon{position:relative;width:33px;height:33px;flex:0 0 33px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary)}.dc-drawer-device-icon .dc-demo-dot{position:absolute;right:-1px;top:-1px;width:8px;height:8px;border:2px solid var(--dsw-alias-bg-layer-1)}.dc-drawer-device-name{font-size:13px;font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-drawer-device-meta{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:3px}.dc-drawer-device>svg{margin-left:auto;color:var(--dsw-alias-label-secondary);transition:transform .18s}.dc-drawer-device.dc-open>svg{transform:rotate(180deg)}.dc-device-menu{position:absolute;z-index:3;top:62px;left:14px;right:14px;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}.dc-device-option{width:100%;display:flex;align-items:center;gap:8px;padding:9px 8px;border:0;border-radius:8px;background:transparent;text-align:left;font-size:11px;color:var(--dsw-alias-label-primary)}.dc-device-option:hover,.dc-device-option.dc-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary)}.dc-device-option>svg{margin-left:auto}.dc-offline-dot{background:var(--dsw-alias-label-secondary)!important}.dc-drawer-new{margin:3px 14px 9px;min-height:40px;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font-size:11px;font-weight:650}.dc-drawer-new:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.dc-drawer-scroll{flex:1;min-height:0;overflow:auto;padding:0 10px 14px}.dc-drawer-section{display:flex;align-items:center;gap:6px;padding:12px 6px 7px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600}.dc-drawer-section span{margin-left:auto;font-size:9px;font-weight:400}.dc-workspace-group{margin-bottom:3px}.dc-workspace-row{display:flex;align-items:center;border-radius:10px}.dc-workspace{flex:1;min-width:0;display:flex;align-items:center;gap:9px;padding:9px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);text-align:left}.dc-workspace:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dc-workspace.dc-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary)}.dc-workspace>svg:last-child{transition:transform .18s}.dc-workspace.dc-open>svg:last-child{transform:rotate(90deg)}.dc-workspace-name{flex:1;min-width:0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-workspace-count{font-size:9px;color:var(--dsw-alias-label-secondary)}.dc-workspace-add{width:27px;height:27px;flex:0 0 27px;margin-right:4px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);display:grid;place-items:center}.dc-workspace-add:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}.dc-workspace-sessions{padding:2px 0 4px 19px}.dc-drawer-session{width:100%;display:flex;align-items:flex-start;gap:8px;padding:8px 9px;border:0;border-radius:10px;background:transparent;text-align:left;color:var(--dsw-alias-label-primary)}.dc-drawer-session:hover{background:var(--dsw-alias-bg-layer-2)}.dc-drawer-session.dc-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1))}.dc-drawer-session-copy{flex:1;min-width:0}.dc-drawer-session-title{display:block;font-size:10px;font-weight:610;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-drawer-session-meta{display:block;font-size:8px;color:var(--dsw-alias-label-secondary);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-drawer-session-time{font-size:8px;color:var(--dsw-alias-label-secondary);margin-left:auto;padding-left:4px}.dc-session-dot{width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);margin-top:5px}.dc-session-dot.dc-active{background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}.dc-session-dot.dc-pending{background:var(--dsw-alias-state-warn-primary)}.dc-drawer-more{display:flex;align-items:center;justify-content:space-between;width:calc(100% - 8px);margin:1px 4px 5px 28px;padding:7px 9px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:9px;text-align:left}.dc-drawer-more:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}.dc-drawer-empty{padding:18px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:10px}.dc-drawer-footer{padding:11px 17px;border-top:1px solid var(--dsw-alias-border-l1);font-size:9px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px}@keyframes dcDrawerIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
      .dc-settings-group button.dc-setting-row{width:100%;border-left:0;border-right:0;border-top:0;background:transparent;text-align:left;color:var(--dsw-alias-label-primary)}.dc-settings-group button.dc-setting-row:hover{background:var(--dsw-alias-bg-layer-2)}.dc-setting-row .dc-badge{margin-left:auto}.dc-voice-hero{display:flex;align-items:center;gap:12px;padding:15px;margin-bottom:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1))}.dc-voice-hero-icon{width:42px;height:42px;flex:0 0 42px;border-radius:13px;display:grid;place-items:center;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}.dc-voice-hero-title{font-size:13px;font-weight:720}.dc-voice-hero-copy{font-size:10px;line-height:1.55;color:var(--dsw-alias-label-secondary);margin-top:3px}.dc-voice-note{display:flex;align-items:flex-start;gap:8px;padding:11px 12px;margin:10px 0 14px;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.6}.dc-voice-note svg{flex:0 0 auto;color:var(--dsw-alias-brand-primary)}.dc-tts-panel{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:15px;background:var(--dsw-alias-bg-layer-1)}.dc-tts-head{display:flex;align-items:center;gap:8px;margin-bottom:13px}.dc-tts-title{font-size:12px;font-weight:700}.dc-tts-sub{font-size:9px;color:var(--dsw-alias-label-secondary);margin-top:2px}.dc-tts-head .dc-badge{margin-left:auto}.dc-tts-panel .dc-field{margin-bottom:12px}.dc-tts-panel .dc-field label{font-size:10px}.dc-tts-panel .dc-input,.dc-tts-panel .dc-select{font-size:11px}.dc-tts-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.dc-tts-preview{width:100%;margin-top:8px}.dc-tts-footnote{font-size:9px;color:var(--dsw-alias-label-secondary);line-height:1.6;text-align:center;margin-top:11px}.dc-connected-copy{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-state-success-primary);font-size:10px;margin-top:9px}@media(prefers-reduced-motion:reduce){.dc-session-drawer,.dc-voice-wave i,.dc-recording-dot{animation:none}}
      @media(max-width:1100px){.dc-guide{display:none}.dc-admin-side{width:66px;flex-basis:66px;padding:16px 9px}.dc-admin-brand-name,.dc-admin-brand-sub,.dc-admin-nav button span,.dc-admin-user>div:not(.dc-avatar){display:none}.dc-admin-brand{padding:0 6px 20px}.dc-admin-nav button{justify-content:center;padding:0}.dc-admin-nav .dc-nav-count{display:none}.dc-admin-user{justify-content:center;padding:14px 0 0}.dc-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dc-grid-main{grid-template-columns:1fr}.dc-admin-head .dc-search{display:none}}
      @media(max-width:720px){.dc-brand{min-width:0}.dc-brand-sub,.dc-demo{display:none}.dc-topbar{padding:0 13px;gap:10px}.dc-switch button{padding:7px 10px}.dc-mobile-stage{padding:16px}.dc-policy-grid,.dc-settings-grid{grid-template-columns:1fr}.dc-policy-list{display:none}.dc-admin-wrap{padding:8px}.dc-admin-content{padding:14px}.dc-env{display:none}}
    `;

    const PATHS = {
      chat: ['M20 11.5a7.5 7.5 0 0 1-8 7.5 9.5 9.5 0 0 1-3.5-.7L4 20l1.6-4.2A7.5 7.5 0 1 1 20 11.5Z', 'M8 10h8M8 14h5'],
      check: ['M20 6 9 17l-5-5'], tasks: ['M9 5h10M9 12h10M9 19h10', 'm3 5 1.5 1.5L7 4M3 12l1.5 1.5L7 11M3 19l1.5 1.5L7 18'],
      monitor: ['M3 4h18v12H3zM8 21h8M12 16v5'], phone: ['M7 2h10v20H7zM10 5h4M11 19h2'],
      user: ['M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z'], users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
      home: ['m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7'], shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4'],
      lock: ['M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3M12 14v3'], search: ['M21 21l-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
      plus: ['M12 5v14M5 12h14'], bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'],
      chevron: ['m9 18 6-6-6-6'], back: ['m15 18-6-6 6-6'], send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
      stop: ['M6 6h12v12H6z'], x: ['M18 6 6 18M6 6l12 12'], settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z'],
      activity: ['M3 12h4l3-9 4 18 3-9h4'], list: ['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
      clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'], command: ['M18 9a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3Z'],
      wifi: ['M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a14 14 0 0 1 20 0'],
      key: ['M21 2 13.6 9.4M15 4l5 5M11 11a6 6 0 1 1-8.5 5.5A6 6 0 0 1 11 11Z'], globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z'],
      eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
      refresh: ['M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.5-2.6L20 11M4 13l2.4 4.6A7 7 0 0 0 17.9 15'],
      logout: ['M10 17l5-5-5-5M15 12H3M15 3h6v18h-6'], more: ['M5 12h.01M12 12h.01M19 12h.01'],
      menu: ['M4 7h16M4 12h16M4 17h10'], folder: ['M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
      mic: ['M9 2h6v12H9zM5 10a7 7 0 0 0 14 0M12 17v5M8 22h8'], keyboard: ['M2 5h20v14H2zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10'],
      volume: ['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12'], cloud: ['M17.5 19H7a5 5 0 1 1 1.7-9.7A6 6 0 0 1 20 11a4 4 0 0 1-2.5 8Z'], wave: ['M3 10v4M7 7v10M11 4v16M15 7v10M19 10v4M23 10v4'], info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 11v6M12 7h.01'],
    };

    function Icon({ name, size = 18, strokeWidth = 1.8 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        ...(PATHS[name] || PATHS.activity).map((d, i) => h('path', { d, key: i })));
    }
    const I = (name, size) => h(Icon, { name, size });
    function Logo({ size = 26 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 5, y: 3, width: 15, height: 26, rx: 5, stroke: 'currentColor', strokeWidth: 2 }),
        h('path', { d: 'M10 10h5M10 15h5M11 24h3M20 11h2a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5h-2', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
        h('circle', { cx: 25, cy: 7, r: 3, fill: 'currentColor' }));
    }
    function Badge({ children, tone = '' }) { return h('span', { className: `dc-badge ${tone ? `dc-${tone}` : ''}` }, children); }
    function Button({ children, icon, kind = '', onClick, disabled, style }) {
      return h('button', { type: 'button', className: `dc-btn ${kind ? `dc-${kind}` : ''}`, onClick, disabled, style }, icon && I(icon, 15), children);
    }
    function Toggle({ value, onChange, label }) {
      return h('button', { type: 'button', className: `dc-toggle ${value ? 'dc-on' : ''}`, role: 'switch', 'aria-checked': value, 'aria-label': label, onClick: () => onChange(!value) }, h('span'));
    }
    function Avatar({ children }) { return h('div', { className: 'dc-avatar' }, children); }
    function Search({ value, onChange, placeholder }) {
      return h('div', { className: 'dc-search' }, I('search', 15), h('input', { value, onChange: e => onChange(e.target.value), placeholder }));
    }
    function PhoneStatus() {
      return h('div', { className: 'dc-phone-status' }, h('span', null, '9:41'), h('div', { className: 'dc-notch' }), h('span', null, '5G  ▰'));
    }
    function PhoneSheet({ title, copy, icon = 'shield', confirmText, onConfirm, onClose, danger }) {
      const ref = useRef(null);
      useEffect(() => {
        const previous = document.activeElement;
        const root = ref.current;
        root && root.querySelector('button') && root.querySelector('button').focus();
        const key = e => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Tab' && root) {
            const items = [...root.querySelectorAll('button:not(:disabled)')];
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        };
        window.addEventListener('keydown', key);
        return () => { window.removeEventListener('keydown', key); previous && previous.focus && previous.focus(); };
      }, [onClose]);
      return h('div', { className: 'dc-sheet-layer', onClick: onClose },
        h('div', { className: 'dc-sheet', role: 'dialog', 'aria-modal': true, 'aria-label': title, ref, onClick: e => e.stopPropagation() },
          h('div', { className: 'dc-sheet-handle' }), h('div', { className: 'dc-sheet-icon' }, I(icon, 27)),
          h('div', { className: 'dc-sheet-title' }, title), h('div', { className: 'dc-sheet-copy' }, copy),
          h('div', { className: 'dc-button-row' }, h(Button, { onClick: onClose }, '再想想'), h(Button, { kind: danger ? 'danger' : 'primary', onClick: onConfirm }, confirmText))));
    }

    const INITIAL_SESSIONS = [
      { id: 's1', title: '设计 DSH Connect 高保真原型', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'active', preview: '已完成管理后台概览与设备页面，正在补齐移动端交互…', time: '刚刚', unread: true },
      { id: 's2', title: '修复 WebSocket 断线重连', device: 'MacBook Pro', workspace: 'server', status: 'pending', preview: '执行集成测试前需要你的审批', time: '2 分钟前', unread: true },
      { id: 's3', title: '实现会话事件协议', device: 'Office Mac Studio', workspace: 'protocol', status: 'finished', preview: '已生成 OpenAPI 与 AsyncAPI 初稿，所有检查通过。', time: '18:26' },
      { id: 's4', title: '补充移动端断网测试', device: 'Office Mac Studio', workspace: 'mobile', status: 'finished', preview: '覆盖 12 个断网与恢复场景。', time: '昨天' },
      { id: 's5', title: '优化会话抽屉交互', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '完成工作区展开与会话分页交互。', time: '11:02' },
      { id: 's6', title: '补充设备切换异常状态', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '覆盖设备离线与工作区不可用状态。', time: '10:48' },
      { id: 's7', title: '评审 Connector 鉴权方案', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '已整理设备指纹与凭据轮换建议。', time: '10:21' },
      { id: 's8', title: '编写移动端发布检查单', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '检查单包含 18 项发布前验证。', time: '09:56' },
      { id: 's9', title: '更新远程审批文案', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '明确高风险操作的影响范围。', time: '09:32' },
      { id: 's10', title: '排查通知重复送达', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '已定位事件游标重复提交场景。', time: '昨天' },
      { id: 's11', title: '整理工作区权限矩阵', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '形成成员、设备与工作区权限矩阵。', time: '昨天' },
      { id: 's12', title: '设计离线消息同步', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '已完成断线恢复协议初稿。', time: '周二' },
      { id: 's13', title: '优化语音输入波形', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '补充减少动态效果的系统设置适配。', time: '周二' },
      { id: 's14', title: '验证 TTS 连接异常', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '覆盖凭据缺失、超时与重试状态。', time: '周一' },
      { id: 's15', title: '整理原型体验反馈', device: 'MacBook Pro', workspace: 'dsh-connect', status: 'finished', preview: '已汇总导航、语音与审批链路反馈。', time: '周一' },
    ];
    const INITIAL_MESSAGES = [
      { id: 1, role: 'user', text: '继续完成高保真原型，优先验证会话和审批流程。', time: '21:58' },
      { id: 2, role: 'assistant', text: '我会先完成移动端会话与审批页面，再检查管理后台的权限和审计链路。', time: '21:58' },
      { id: 3, role: 'tool', name: '运行原型检查', command: 'pnpm prototype:check', result: '18 项检查通过 · 耗时 4.2s' },
      { id: 4, role: 'assistant', text: '移动端主流程已连通。接下来补充审批过期、设备离线和重复提交三种异常状态。', time: '22:01' },
    ];
    const STATUS = {
      active: ['运行中', 'brand'], pending: ['待审批', 'warn'], finished: ['已完成', 'success'], error: ['异常', 'error'], offline: ['离线', ''],
    };

    const DEVICES = [
      { name: 'MacBook Pro', online: true, meta: '在线 · 延迟 18ms', workspaces: ['dsh-connect', 'server'] },
      { name: 'Office Mac Studio', online: false, meta: '离线 · 可查看历史会话', workspaces: ['protocol', 'mobile'] },
    ];
    const TTS_PROVIDERS = {
      volcengine: { name: '火山引擎', model: 'doubao-tts', endpoint: 'https://openspeech.bytedance.com' },
      aliyun: { name: '阿里云', model: 'cosyvoice-v2', endpoint: 'https://dashscope.aliyuncs.com' },
      tencent: { name: '腾讯云', model: 'tts-basic', endpoint: 'https://tts.tencentcloudapi.com' },
    };
    const DEMO_TRANSCRIPT = '继续完善移动端原型，并检查语音输入和模型服务配置。';

    function SessionCard({ session, onClick }) {
      const state = STATUS[session.status] || STATUS.finished;
      return h('button', { type: 'button', className: 'dc-session-card', onClick },
        h('div', { className: 'dc-session-top' }, h('div', { className: 'dc-session-title' }, session.title), h(Badge, { tone: state[1] }, state[0])),
        h('div', { className: 'dc-session-preview' }, session.preview),
        h('div', { className: 'dc-session-foot' }, h('span', null, `${session.device} · ${session.workspace}`), h('span', null, session.time)));
    }
    function SessionDrawer({ sessions, selected, currentDevice, currentWorkspace, expandedWorkspace, sessionLimit, deviceMenu, onToggleDevice, onDevice, onWorkspace, onMore, onCollapse, onNew, onOpen, onClose }) {
      const device = DEVICES.find(d => d.name === currentDevice) || DEVICES[0];
      useEffect(() => { const key = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
      return h('div', { className: 'dc-drawer-layer' },
        h('button', { type: 'button', className: 'dc-drawer-backdrop', onClick: onClose, 'aria-label': '关闭会话侧边栏' }),
        h('aside', { className: 'dc-session-drawer', role: 'dialog', 'aria-modal': true, 'aria-label': '设备、工作区与会话' },
          h('div', { className: 'dc-drawer-device-wrap' },
            h('button', { type: 'button', className: `dc-drawer-device ${deviceMenu ? 'dc-open' : ''}`, onClick: onToggleDevice, 'aria-expanded': deviceMenu },
              h('span', { className: 'dc-drawer-device-icon' }, I('monitor', 18), h('span', { className: `dc-demo-dot ${device.online ? '' : 'dc-offline-dot'}` })),
              h('span', { style: { flex: 1, minWidth: 0 } }, h('span', { className: 'dc-drawer-device-name', style: { display: 'block' } }, device.name), h('span', { className: 'dc-drawer-device-meta', style: { display: 'block' } }, device.meta)), I('chevron', 15)),
            deviceMenu && h('div', { className: 'dc-device-menu' }, ...DEVICES.map(d => h('button', { type: 'button', key: d.name, className: `dc-device-option ${d.name === currentDevice ? 'dc-on' : ''}`, onClick: () => onDevice(d) }, h('span', { className: `dc-demo-dot ${d.online ? '' : 'dc-offline-dot'}` }), h('span', null, d.name), d.name === currentDevice && I('check', 13))))),
          h('button', { type: 'button', className: 'dc-drawer-new', onClick: () => onNew(currentWorkspace) }, I('plus', 16), '新建会话', h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 9, fontWeight: 400 } }, `· ${currentWorkspace}`)),
          h('div', { className: 'dc-drawer-scroll' }, h('div', { className: 'dc-drawer-section' }, '工作区', h('span', null, `${device.workspaces.length} 个 · 展开查看会话`)),
            ...device.workspaces.map(name => {
              const items = sessions.filter(s => s.device === currentDevice && s.workspace === name);
              const open = expandedWorkspace === name;
              const shown = open ? items.slice(0, sessionLimit) : [];
              const remaining = Math.max(0, items.length - shown.length);
              return h('div', { className: 'dc-workspace-group', key: name },
                h('div', { className: 'dc-workspace-row' },
                  h('button', { type: 'button', className: `dc-workspace ${name === currentWorkspace ? 'dc-on' : ''} ${open ? 'dc-open' : ''}`, onClick: () => onWorkspace(name), 'aria-expanded': open }, I('folder', 16), h('span', { className: 'dc-workspace-name' }, name), h('span', { className: 'dc-workspace-count' }, items.length), I('chevron', 13)),
                  h('button', { type: 'button', className: 'dc-workspace-add', onClick: () => onNew(name), 'aria-label': `在 ${name} 中新建会话` }, I('plus', 15))),
                open && h('div', { className: 'dc-workspace-sessions' },
                  shown.length ? shown.map(s => h('button', { type: 'button', key: s.id, className: `dc-drawer-session ${selected.id === s.id ? 'dc-on' : ''}`, onClick: () => onOpen(s) }, h('span', { className: `dc-session-dot dc-${s.status}` }), h('span', { className: 'dc-drawer-session-copy' }, h('span', { className: 'dc-drawer-session-title' }, s.title), h('span', { className: 'dc-drawer-session-meta' }, s.preview)), h('span', { className: 'dc-drawer-session-time' }, s.time))) : h('div', { className: 'dc-drawer-empty' }, '这个工作区还没有会话'),
                  remaining > 0 ? h('button', { type: 'button', className: 'dc-drawer-more', onClick: () => onMore(name) }, h('span', null, `查看更多（${remaining}）`), h('span', null, '›')) : items.length > 5 ? h('button', { type: 'button', className: 'dc-drawer-more', onClick: () => onCollapse(name) }, h('span', null, '收起'), h('span', null, '⌃')) : null));
            })),
          h('div', { className: 'dc-drawer-footer' }, h('span', { className: `dc-demo-dot ${device.online ? '' : 'dc-offline-dot'}` }), `${device.online ? '设备在线' : '设备离线'} · 每个工作区默认展示 5 条会话`)));
    }

    function VoiceServiceSettings({ go, voiceEnabled, setVoiceEnabled, tts, setTts, testing, onTest, onSave, onPreview, notify }) {
      const [showKey, setShowKey] = useState(false);
      const update = (key, value, reset = false) => setTts(prev => ({ ...prev, [key]: value, connected: reset ? false : prev.connected, saved: reset ? false : prev.saved }));
      const provider = TTS_PROVIDERS[tts.provider];
      const settingToggle = (icon, title, sub, value, onChange) => h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-icon' }, I(icon, 16)), h('div', { className: 'dc-setting-text' }, title, h('div', { className: 'dc-setting-sub' }, sub)), h(Toggle, { value, label: title, onChange }));
      return h('div', { className: 'dc-phone-scroll' },
        h('div', { className: 'dc-detail-head' }, h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => go('profile'), 'aria-label': '返回我的' }, I('back', 17)), h('div', { className: 'dc-detail-title' }, '语音与模型服务'), h(Badge, { tone: tts.connected ? 'success' : '' }, tts.connected ? '已连接' : '演示')),
        h('div', { className: 'dc-voice-hero' }, h('div', { className: 'dc-voice-hero-icon' }, I('wave', 22)), h('div', null, h('div', { className: 'dc-voice-hero-title' }, '自然地说，顺畅地听'), h('div', { className: 'dc-voice-hero-copy' }, '按住说话发送指令，也可以使用云厂商 TTS 朗读 Agent 回复。'))),
        h('div', { className: 'dc-voice-note' }, I('info', 15), h('div', null, 'ASR 与 TTS 是两项独立能力：ASR 负责语音转文字，TTS 负责语音合成与回复播报。')),
        h('div', { className: 'dc-section-label' }, '语音输入 · ASR'), h('div', { className: 'dc-settings-group' }, settingToggle('mic', '按住说话', '在会话输入区启用语音模式', voiceEnabled, setVoiceEnabled), h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-icon' }, I('globe', 16)), h('div', { className: 'dc-setting-text' }, '识别语言', h('div', { className: 'dc-setting-sub' }, '语音转写使用系统 ASR 能力')), h('select', { className: 'dc-select', style: { width: 112, padding: 6, fontSize: 10 }, defaultValue: 'zh' }, h('option', { value: 'zh' }, '中文（普通话）'), h('option', { value: 'en' }, 'English')))),
        h('div', { className: 'dc-section-label' }, '云厂商 TTS'), h('section', { className: 'dc-tts-panel' },
          h('div', { className: 'dc-tts-head' }, h('div', { className: 'dc-setting-icon' }, I('cloud', 16)), h('div', null, h('div', { className: 'dc-tts-title' }, '语音合成服务'), h('div', { className: 'dc-tts-sub' }, '连接你的云厂商模型服务')), h(Badge, { tone: tts.connected ? 'success' : testing ? 'warn' : '' }, testing ? '检测中' : tts.connected ? '连接正常' : '未连接')),
          h('div', { className: 'dc-field' }, h('label', null, '云厂商'), h('select', { className: 'dc-select', value: tts.provider, onChange: e => { const next = TTS_PROVIDERS[e.target.value]; setTts(prev => ({ ...prev, provider: e.target.value, endpoint: next.endpoint, model: next.model, connected: false, saved: false })); } }, ...Object.entries(TTS_PROVIDERS).map(([id, p]) => h('option', { key: id, value: id }, p.name)))),
          h('div', { className: 'dc-field' }, h('label', null, '服务地址'), h('input', { className: 'dc-input', value: tts.endpoint, onChange: e => update('endpoint', e.target.value, true), spellCheck: false })),
          h('div', { className: 'dc-field' }, h('label', null, 'API Key / Access Token'), h('input', { className: 'dc-input', type: showKey ? 'text' : 'password', value: tts.apiKey, onChange: e => update('apiKey', e.target.value, true), placeholder: '输入云厂商凭据', autoComplete: 'off', spellCheck: false }), h('button', { type: 'button', className: 'dc-panel-link', style: { marginTop: 5 }, onClick: () => setShowKey(v => !v) }, showKey ? '隐藏凭据' : '显示凭据')),
          h('div', { className: 'dc-field' }, h('label', null, 'TTS 模型 / 接入点'), h('input', { className: 'dc-input', value: tts.model, onChange: e => update('model', e.target.value, true), placeholder: '输入模型或接入点 ID', spellCheck: false })),
          h('div', { className: 'dc-field' }, h('label', null, '默认音色'), h('select', { className: 'dc-select', value: tts.voice, onChange: e => update('voice', e.target.value) }, ...['清澈女声 · 中文', '温暖男声 · 中文', '甜美女声 · 中文', 'Ava · English'].map(v => h('option', { key: v }, v)))),
          h('div', { className: 'dc-field', style: { marginBottom: 0 } }, h('label', null, '语速'), h('select', { className: 'dc-select', value: tts.speed, onChange: e => update('speed', e.target.value) }, ...[['0.75', '0.75× · 较慢'], ['1.0', '1.0× · 标准'], ['1.25', '1.25× · 较快'], ['1.5', '1.5× · 快速']].map(([v, label]) => h('option', { key: v, value: v }, label)))),
          tts.connected && h('div', { className: 'dc-connected-copy' }, I('check', 13), `${provider.name}连接正常 · 延迟 286ms（模拟）`),
          h('div', { className: 'dc-tts-actions' }, h(Button, { icon: 'activity', disabled: testing, onClick: onTest }, testing ? '正在测试…' : '测试连接'), h(Button, { kind: 'primary', icon: 'check', onClick: onSave }, '保存配置')),
          h(Button, { kind: 'ghost', icon: 'volume', style: { width: '100%', marginTop: 8 }, onClick: onPreview }, '试听默认音色'),
          h('div', { className: 'dc-tts-footnote' }, '原型不会发起真实云端请求。正式产品中，凭据应加密保存在系统钥匙串。')),
        h('div', { className: 'dc-section-label' }, '播报偏好'), h('div', { className: 'dc-settings-group' }, settingToggle('volume', '自动播报回复', 'Agent 回复完成后使用 TTS 朗读', tts.autoPlay, value => { update('autoPlay', value); notify(value ? 'Agent 回复自动播报已开启' : 'Agent 回复自动播报已关闭'); })),
        h(Button, { kind: 'primary', icon: 'mic', style: { width: '100%', marginTop: 16 }, onClick: () => go('chat') }, '去会话体验语音输入'));
    }

    function MobileNav({ t, page, go, count }) {
      const items = [['chat', 'chat', t('sessions')], ['tasks', 'tasks', t('tasks')], ['devices', 'monitor', t('devices')], ['profile', 'user', t('profile')]];
      return h('nav', { className: 'dc-phone-nav', 'aria-label': 'App navigation' }, ...items.map(([id, icon, label]) =>
        h('button', { type: 'button', key: id, className: page === id ? 'dc-on' : '', onClick: () => go(id) }, I(icon, 20), h('span', null, label), id === 'tasks' && count > 0 && h('span', { className: 'dc-nav-badge' }, count))));
    }

    function MobileApp({ t, notify, screen, setScreen }) {
      const [sessions, setSessions] = useState(INITIAL_SESSIONS);
      const [selected, setSelected] = useState(INITIAL_SESSIONS[0]);
      const [messages, setMessages] = useState(INITIAL_MESSAGES);
      const [draft, setDraft] = useState('');
      const [query, setQuery] = useState('');
      const [filter, setFilter] = useState('all');
      const [running, setRunning] = useState(false);
      const [approvalState, setApprovalState] = useState('pending');
      const [sheet, setSheet] = useState(null);
      const [newPrompt, setNewPrompt] = useState('');
      const [preferences, setPreferences] = useState({ push: true, bio: true, private: true, approval: true });
      const [drawerOpen, setDrawerOpen] = useState(false);
      const [deviceMenu, setDeviceMenu] = useState(false);
      const [currentDevice, setCurrentDevice] = useState('MacBook Pro');
      const [currentWorkspace, setCurrentWorkspace] = useState('dsh-connect');
      const [expandedWorkspace, setExpandedWorkspace] = useState('dsh-connect');
      const [sessionLimit, setSessionLimit] = useState(5);
      const [voiceMode, setVoiceMode] = useState(false);
      const [voiceEnabled, setVoiceEnabled] = useState(true);
      const [voiceStatus, setVoiceStatus] = useState('idle');
      const [voiceTranscript, setVoiceTranscript] = useState('');
      const [voiceElapsed, setVoiceElapsed] = useState(0);
      const [tts, setTts] = useState({ provider: 'volcengine', endpoint: TTS_PROVIDERS.volcengine.endpoint, apiKey: '', model: TTS_PROVIDERS.volcengine.model, voice: '清澈女声 · 中文', speed: '1.0', autoPlay: false, connected: false, saved: false });
      const [ttsTesting, setTtsTesting] = useState(false);
      const timers = useRef([]);
      const voiceTimer = useRef(null);
      const voiceStartedAt = useRef(0);
      const messageCache = useRef({ s1: INITIAL_MESSAGES });
      useEffect(() => () => { timers.current.forEach(clearTimeout); clearInterval(voiceTimer.current); }, []);
      useEffect(() => { if (selected && selected.id) messageCache.current[selected.id] = messages; }, [messages, selected]);
      const go = page => { setScreen(page); setSheet(null); setDrawerOpen(false); setDeviceMenu(false); };
      const openSession = session => {
        const cached = messageCache.current[session.id] || [{ id: 1, role: 'assistant', text: session.preview, time: session.time }];
        messageCache.current[session.id] = cached;
        setSelected(session); setMessages(cached); setCurrentDevice(session.device); setCurrentWorkspace(session.workspace); setExpandedWorkspace(session.workspace);
        const index = sessions.filter(s => s.device === session.device && s.workspace === session.workspace).findIndex(s => s.id === session.id);
        setSessionLimit(Math.max(5, index + 1)); setDraft(''); setVoiceMode(false); setVoiceStatus('idle'); go('chat');
      };
      const startVoice = e => {
        if (!voiceEnabled || voiceStatus !== 'idle') return;
        if (e) { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} }
        clearInterval(voiceTimer.current); setVoiceStatus('listening'); setVoiceTranscript(''); setVoiceElapsed(0); voiceStartedAt.current = Date.now();
        voiceTimer.current = setInterval(() => { const elapsed = Date.now() - voiceStartedAt.current; setVoiceElapsed(elapsed); const count = Math.max(0, Math.min(DEMO_TRANSCRIPT.length, Math.floor((elapsed - 250) / 65))); setVoiceTranscript(DEMO_TRANSCRIPT.slice(0, count)); }, 100);
      };
      const finishVoice = () => {
        if (voiceStatus !== 'listening') return;
        clearInterval(voiceTimer.current); setVoiceStatus('processing'); setVoiceTranscript(DEMO_TRANSCRIPT);
        timers.current.push(setTimeout(() => { setDraft(prev => `${prev.trim() ? `${prev.trim()}\n` : ''}${DEMO_TRANSCRIPT}`); setVoiceStatus('idle'); setVoiceMode(false); setVoiceTranscript(''); notify('语音已转写，可继续编辑或发送'); }, 650));
      };
      const validTts = () => { if (tts.endpoint.trim() && tts.apiKey.trim() && tts.model.trim()) return true; notify('请完整填写服务地址、凭据和模型'); return false; };
      const testTts = () => {
        if (!validTts()) return;
        setTtsTesting(true); setTts(prev => ({ ...prev, connected: false }));
        timers.current.push(setTimeout(() => { setTtsTesting(false); setTts(prev => ({ ...prev, connected: true, saved: true })); notify(`${TTS_PROVIDERS[tts.provider].name} TTS 连接成功（模拟）`); }, 900));
      };
      const saveTts = () => { if (!validTts()) return; setTts(prev => ({ ...prev, saved: true })); notify('TTS 服务配置已保存到本次原型会话'); };
      const previewTts = () => notify(tts.connected ? `正在试听「${tts.voice}」（模拟）` : '请先完成 TTS 连接测试');
      const playMessage = () => notify(tts.connected ? `正在通过 ${TTS_PROVIDERS[tts.provider].name} 朗读回复（模拟）` : '请先在“我的”中配置并连接 TTS 服务');
      const send = () => {
        const text = draft.trim(); if (!text || running) return;
        setMessages(list => [...list, { id: Date.now(), role: 'user', text, time: '刚刚' }]); setDraft(''); setRunning(true); notify('DSH 已接受指令，等待桌面端执行');
        timers.current.push(setTimeout(() => { setMessages(list => [...list, { id: Date.now() + 1, role: 'assistant', text: '收到。我会沿用当前工作区与权限策略继续执行，并在需要审批时通知你。', time: '刚刚' }]); setRunning(false); }, 900));
      };
      const decide = decision => {
        if (decision === 'allow') { setSheet('approval'); return; }
        setApprovalState('rejected'); notify('已拒绝本次操作'); go('tasks');
      };
      const createSession = () => {
        if (!newPrompt.trim()) return;
        const session = { id: `s${Date.now()}`, title: newPrompt.trim().slice(0, 22), device: currentDevice, workspace: currentWorkspace, status: 'active', preview: newPrompt.trim(), time: '刚刚' };
        const initial = [{ id: 1, role: 'user', text: newPrompt.trim(), time: '刚刚' }];
        setSessions(list => [session, ...list]); setSelected(session); setMessages(initial); messageCache.current[session.id] = initial; setExpandedWorkspace(currentWorkspace); setSessionLimit(5); setNewPrompt(''); notify('新会话已创建'); go('chat');
      };
      const pendingCount = approvalState === 'pending' ? 1 : 0;
      let body;
      if (screen === 'sessions') {
        const visible = sessions.filter(s => (filter === 'all' || s.status === filter) && `${s.title}${s.workspace}`.toLowerCase().includes(query.toLowerCase()));
        body = h('div', { className: 'dc-phone-scroll' },
          h('div', { className: 'dc-mobile-head' }, h('div', null, h('div', { className: 'dc-mobile-title' }, t('sessions')), h('div', { className: 'dc-mobile-sub' }, '晚上好，李伟 · 2 个任务正在推进')), h(Button, { kind: 'primary', icon: 'plus', style: { width: 42, padding: 0 }, onClick: () => go('new') })),
          h('div', { className: 'dc-device-pill' }, h('div', { className: 'dc-device-hero', style: { width: 34, height: 34, borderRadius: 10 } }, I('monitor', 18)), h('div', { className: 'dc-grow' }, h('div', { className: 'dc-device-name' }, 'MacBook Pro'), h('div', { className: 'dc-device-meta' }, '局域网 · 延迟 18ms')), h(Badge, { tone: 'success' }, t('online')), I('chevron', 14)),
          h(Search, { value: query, onChange: setQuery, placeholder: t('search') }),
          h('div', { className: 'dc-chips' }, ...[['all', t('all')], ['active', t('active')], ['pending', t('pending')], ['finished', t('finished')]].map(([id, label]) => h('button', { type: 'button', key: id, className: `dc-chip ${filter === id ? 'dc-on' : ''}`, onClick: () => setFilter(id) }, label))),
          h('div', { className: 'dc-session-list' }, ...visible.map(s => h(SessionCard, { key: s.id, session: s, onClick: () => openSession(s) }))),
          visible.length === 0 && h('div', { className: 'dc-guide-copy', style: { textAlign: 'center', padding: 35 } }, '没有匹配的会话'));
      } else if (screen === 'chat') {
        body = h(React.Fragment, null,
          h('div', { className: 'dc-chat-head' }, h('button', { className: 'dc-icon-btn', type: 'button', onClick: () => { if (voiceStatus === 'idle') { setDrawerOpen(true); setDeviceMenu(false); } }, 'aria-label': '打开会话侧边栏' }, I('menu', 18)), h('div', { className: 'dc-chat-title' }, h('div', { className: 'dc-chat-name' }, selected.title), h('div', { className: 'dc-chat-state' }, `● ${selected.device} · ${selected.workspace}`)), h('button', { className: 'dc-icon-btn', type: 'button', onClick: () => notify('会话详情与权限信息'), 'aria-label': '更多' }, I('more', 18))),
          h('div', { className: 'dc-chat-messages' },
            h('div', { className: 'dc-date' }, '今天 21:58'),
            ...messages.map(m => m.role === 'tool' ? h('div', { className: 'dc-tool-card', key: m.id }, h('div', { className: 'dc-tool-head' }, h('div', { className: 'dc-tool-icon' }, I('command', 15)), m.name, h('span', { style: { marginLeft: 'auto' } }, h(Badge, { tone: 'success' }, '成功'))), h('div', { className: 'dc-code' }, m.command), h('div', { className: 'dc-message-time' }, m.result)) : h('div', { className: `dc-message ${m.role === 'user' ? 'dc-user' : 'dc-assistant'}`, key: m.id }, h('div', { className: 'dc-bubble' }, m.text, h('div', { className: 'dc-message-time' }, m.time)), m.role === 'assistant' && h('button', { type: 'button', className: 'dc-message-tts', onClick: playMessage }, I('volume', 13), '朗读'))),
            running && h('div', { className: 'dc-message' }, h('div', { className: 'dc-bubble' }, '● 正在接收桌面端事件…'))),
          h('div', { className: 'dc-composer' },
            voiceStatus !== 'idle' && h('div', { className: `dc-voice-feedback ${voiceStatus === 'processing' ? 'dc-processing' : ''}` },
              h('div', { className: 'dc-voice-status' }, voiceStatus === 'processing' ? I('activity', 15) : h('span', { className: 'dc-recording-dot' }), h('span', null, voiceStatus === 'processing' ? '正在将语音转写为文字…' : '正在聆听，请开始说话'), h('span', { className: 'dc-voice-time' }, `00:${String(Math.floor(voiceElapsed / 1000)).padStart(2, '0')}`)),
              voiceStatus === 'listening' && h('div', { className: 'dc-voice-wave' }, ...Array.from({ length: 13 }, (_, i) => h('i', { key: i, style: { '--i': i } }))),
              h('div', { className: 'dc-voice-transcript' }, voiceTranscript || (voiceStatus === 'listening' ? '正在等待语音…' : '请稍候'))),
            h('div', { className: 'dc-compose-box dc-voice-compose' },
              h('button', { type: 'button', className: `dc-voice-switch ${voiceMode ? 'dc-on' : ''}`, disabled: !voiceEnabled || voiceStatus !== 'idle', onClick: () => setVoiceMode(v => !v), 'aria-label': voiceMode ? '切换为键盘输入' : '切换为语音输入' }, I(voiceMode ? 'keyboard' : 'mic', 19)),
              voiceMode ? h(React.Fragment, null,
                h('button', { type: 'button', className: `dc-hold-talk ${voiceStatus === 'listening' ? 'dc-listening' : ''}`, disabled: voiceStatus === 'processing', onPointerDown: startVoice, onPointerUp: finishVoice, onPointerCancel: finishVoice, onKeyDown: e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) startVoice(e); }, onKeyUp: e => { if (e.key === ' ' || e.key === 'Enter') finishVoice(); } }, I(voiceStatus === 'listening' ? 'wave' : 'mic', 17), voiceStatus === 'listening' ? '松开完成' : voiceStatus === 'processing' ? '正在转写…' : '按住说话'),
                h('button', { type: 'button', className: 'dc-voice-switch', onClick: () => notify('更多会话功能'), 'aria-label': '更多功能' }, I('plus', 19))) : h(React.Fragment, null,
                h('textarea', { value: draft, onChange: e => setDraft(e.target.value), placeholder: '发消息或按住说话…', onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } }),
                h('button', { type: 'button', className: 'dc-send', disabled: !draft.trim() || running, onClick: send, 'aria-label': t('send') }, I('send', 15)))),
            voiceMode && h('div', { className: 'dc-compose-hint' }, '按住说话，松开完成转写 · 原型使用模拟识别'),
            running && h('button', { type: 'button', className: 'dc-stop', onClick: () => { setRunning(false); notify('已请求取消当前 Turn'); } }, '■  停止当前任务')));
      } else if (screen === 'tasks') {
        body = h('div', { className: 'dc-phone-scroll' }, h('div', { className: 'dc-mobile-head' }, h('div', null, h('div', { className: 'dc-mobile-title' }, t('tasks')), h('div', { className: 'dc-mobile-sub' }, `${pendingCount} 项需要你的处理`)), h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => notify('待办已刷新') }, I('refresh', 16))),
          h('div', { className: 'dc-section-label' }, '需要处理'),
          approvalState === 'pending' ? h('button', { type: 'button', className: 'dc-approval-card', style: { width: '100%', textAlign: 'left', color: 'inherit' }, onClick: () => go('approval') }, h('div', { className: 'dc-approval-top' }, h('div', { className: 'dc-risk' }, I('shield', 18)), h('div', null, h('div', { className: 'dc-approval-title' }, '运行集成测试'), h('div', { className: 'dc-approval-sub' }, '高风险操作 · 剩余 04:38')), h('span', { style: { marginLeft: 'auto' } }, I('chevron', 16))), h('div', { className: 'dc-approval-body' }, '修复 WebSocket 断线重连 · server', ), h('div', { className: 'dc-code' }, 'pnpm test:integration'), h(Badge, { tone: 'warn' }, '等待你的决定')) : h('div', { className: 'dc-info-card', style: { textAlign: 'center', padding: 28, color: 'var(--dsw-alias-label-secondary)' } }, I('check', 26), h('div', { style: { marginTop: 9 } }, '待办已清空')),
          h('div', { className: 'dc-section-label' }, '稍后关注'), h('div', { className: 'dc-approval-card' }, h('div', { className: 'dc-approval-top' }, h('div', { className: 'dc-risk', style: { color: 'var(--dsw-alias-state-error-primary)' } }, I('activity', 18)), h('div', null, h('div', { className: 'dc-approval-title' }, '推送证书即将到期'), h('div', { className: 'dc-approval-sub' }, '系统提醒 · 7 天后到期'))), h('div', { className: 'dc-approval-body' }, '更新 APNs 证书后，后台通知才能正常送达。'), h(Button, { onClick: () => notify('已打开通知证书设置') }, '查看设置')));
      } else if (screen === 'approval') {
        body = h('div', { className: 'dc-phone-scroll' }, h('div', { className: 'dc-detail-head' }, h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => go('tasks') }, I('back', 17)), h('div', { className: 'dc-detail-title' }, '操作审批'), h(Badge, { tone: 'warn' }, '高风险')),
          h('div', { className: 'dc-info-card' }, h('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } }, h('div', { className: 'dc-risk' }, I('command', 19)), h('div', null, h('div', { className: 'dc-approval-title' }, '运行集成测试'), h('div', { className: 'dc-approval-sub' }, 'bash · 22:04:18'))), h('div', { className: 'dc-code' }, 'pnpm test:integration\n--workspace server'), h('div', { className: 'dc-approval-body', style: { marginBottom: 0 } }, 'Agent 需要运行完整集成测试，验证断线恢复期间不会重复提交指令。')),
          h('div', { className: 'dc-section-label' }, '影响范围'), h('div', { className: 'dc-info-card' }, ...[['桌面设备', 'MacBook Pro'], ['工作区', 'server'], ['会话', '修复 WebSocket 断线重连'], ['发起者', 'DeepSeek Agent'], ['有效期', '04:38']].map(([k, v]) => h('div', { className: 'dc-info-row', key: k }, h('span', null, k), h('span', null, v)))),
          h('div', { className: 'dc-warning' }, '此操作会在桌面工作区执行命令。请确认命令、路径和会话上下文。批准仅对本次请求有效。'),
          h('div', { className: 'dc-button-row' }, h(Button, { kind: 'danger', onClick: () => decide('reject') }, t('reject')), h(Button, { kind: 'primary', icon: 'shield', onClick: () => decide('allow') }, t('allow'))),
          h(Button, { kind: 'ghost', style: { width: '100%', marginTop: 8 }, onClick: () => openSession(INITIAL_SESSIONS[1]) }, t('view')));
      } else if (screen === 'devices') {
        body = h('div', { className: 'dc-phone-scroll' }, h('div', { className: 'dc-mobile-head' }, h('div', null, h('div', { className: 'dc-mobile-title' }, t('devices')), h('div', { className: 'dc-mobile-sub' }, '2 台桌面 · 1 台在线')), h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => notify('扫描桌面配对码') }, I('plus', 17))),
          ...[
            { name: 'MacBook Pro', meta: 'macOS 15.6 · Connector 1.0.0', online: true, sessions: 2, version: 'DSH 3.8.2', latency: '18ms' },
            { name: 'Office Mac Studio', meta: 'macOS 15.5 · Connector 1.0.0', online: false, sessions: 0, version: 'DSH 3.8.2', latency: '—' },
          ].map(d => h('button', { type: 'button', className: 'dc-device-card', key: d.name, onClick: () => { setSelected({ ...INITIAL_SESSIONS[0], title: d.name, deviceName: d.name, online: d.online }); go('device'); } }, h('div', { className: 'dc-device-row' }, h('div', { className: 'dc-device-hero' }, I('monitor', 23)), h('div', { className: 'dc-grow' }, h('div', { className: 'dc-device-name' }, d.name), h('div', { className: 'dc-device-meta' }, d.meta)), h(Badge, { tone: d.online ? 'success' : '' }, d.online ? t('online') : t('offline'))), h('div', { className: 'dc-session-foot', style: { marginTop: 13 } }, h('span', null, `${d.sessions} 个活跃会话`), h('span', null, d.online ? `延迟 ${d.latency}` : '1 小时前在线')))),
          h('div', { className: 'dc-section-label' }, '配对的手机'), h('div', { className: 'dc-device-card' }, h('div', { className: 'dc-device-row' }, h('div', { className: 'dc-device-hero' }, I('phone', 22)), h('div', { className: 'dc-grow' }, h('div', { className: 'dc-device-name' }, '李伟的 iPhone'), h('div', { className: 'dc-device-meta' }, '当前设备 · Face ID 已开启')), h(Badge, { tone: 'success' }, '受信任'))));
      } else if (screen === 'device') {
        const deviceName = selected.deviceName || 'MacBook Pro'; const online = selected.online !== false;
        body = h('div', { className: 'dc-phone-scroll' }, h('div', { className: 'dc-detail-head' }, h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => go('devices') }, I('back', 17)), h('div', { className: 'dc-detail-title' }, '设备详情'), h(Badge, { tone: online ? 'success' : '' }, online ? t('online') : t('offline'))),
          h('div', { style: { textAlign: 'center', padding: '10px 0 20px' } }, h('div', { className: 'dc-device-hero', style: { width: 66, height: 66, borderRadius: 21, margin: '0 auto 12px' } }, I('monitor', 32)), h('div', { className: 'dc-mobile-title', style: { fontSize: 20 } }, deviceName), h('div', { className: 'dc-mobile-sub' }, '桌面 Connector 已安全连接')),
          h('div', { className: 'dc-info-card' }, ...[['DSH 版本', '3.8.2'], ['Connector', '1.0.0'], ['连接方式', 'WSS · TLS 1.3'], ['活跃会话', online ? '2 个' : '0 个'], ['最后同步', online ? '刚刚' : '1 小时前']].map(([k, v]) => h('div', { className: 'dc-info-row', key: k }, h('span', null, k), h('span', null, v)))),
          h('div', { className: 'dc-section-label' }, '已授权工作区'), h('div', { className: 'dc-info-card' }, ...['dsh-connect', 'server', 'protocol'].map((x, i) => h('div', { className: 'dc-info-row', key: x }, h('span', null, x), h('span', null, ['查看 · 发送 · 取消', '查看 · 发送', '仅查看'][i])))),
          h(Button, { kind: 'danger', icon: 'logout', style: { width: '100%', marginTop: 18 }, onClick: () => setSheet('revoke') }, t('revoke')));
      } else if (screen === 'new') {
        const device = DEVICES.find(d => d.name === currentDevice) || DEVICES[0];
        body = h('div', { className: 'dc-phone-scroll' }, h('div', { className: 'dc-detail-head' }, h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => go('chat') }, I('back', 17)), h('div', { className: 'dc-detail-title' }, t('newSession'))),
          h('div', { className: 'dc-field' }, h('label', null, '桌面设备'), h('select', { className: 'dc-select', value: currentDevice, onChange: e => { const next = DEVICES.find(d => d.name === e.target.value); setCurrentDevice(next.name); setCurrentWorkspace(next.workspaces[0]); setExpandedWorkspace(next.workspaces[0]); } }, ...DEVICES.map(d => h('option', { key: d.name, value: d.name }, `${d.name} · ${d.online ? '在线' : '离线'}`)))),
          h('div', { className: 'dc-field' }, h('label', null, '工作区'), h('select', { className: 'dc-select', value: currentWorkspace, onChange: e => setCurrentWorkspace(e.target.value) }, ...device.workspaces.map(x => h('option', { key: x }, x)))),
          h('div', { className: 'dc-field' }, h('label', null, '首条提示词'), h('textarea', { className: 'dc-textarea', value: newPrompt, onChange: e => setNewPrompt(e.target.value), placeholder: '描述你希望 DSH 完成的任务…' })),
          h('div', { className: 'dc-section-label' }, '高级选项'), h('div', { className: 'dc-info-card' }, h('div', { className: 'dc-info-row' }, h('span', null, 'Agent Preset'), h('span', null, '默认开发代理  ›')), h('div', { className: 'dc-info-row' }, h('span', null, '模型'), h('span', null, '跟随桌面默认  ›'))),
          h(Button, { kind: 'primary', icon: 'send', disabled: !newPrompt.trim(), style: { width: '100%', marginTop: 18 }, onClick: createSession }, t('create')));
      } else if (screen === 'voiceSettings') {
        body = h(VoiceServiceSettings, { go, voiceEnabled, setVoiceEnabled, tts, setTts, testing: ttsTesting, onTest: testTts, onSave: saveTts, onPreview: previewTts, notify });
      } else {
        const pref = (key, icon, title, sub) => h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-icon' }, I(icon, 16)), h('div', { className: 'dc-setting-text' }, title, h('div', { className: 'dc-setting-sub' }, sub)), h(Toggle, { value: preferences[key], label: title, onChange: value => setPreferences(p => ({ ...p, [key]: value })) }));
        body = h('div', { className: 'dc-phone-scroll' }, h('div', { className: 'dc-mobile-head' }, h('div', { className: 'dc-mobile-title' }, t('profile'))),
          h('div', { className: 'dc-device-card', style: { display: 'flex', alignItems: 'center', gap: 12 } }, h(Avatar, null, 'LW'), h('div', null, h('div', { className: 'dc-device-name' }, '李伟'), h('div', { className: 'dc-device-meta' }, 'liwei@example.com · Owner')), h('span', { style: { marginLeft: 'auto' } }, I('chevron', 16))),
          h('div', { className: 'dc-section-label' }, t('general')), h('div', { className: 'dc-settings-group' }, pref('push', 'bell', '任务通知', '完成、失败与设备状态'), pref('approval', 'shield', '审批通知', '高风险操作优先提醒'), pref('bio', 'lock', t('biometric'), '启动和高风险审批时验证')),
          h('div', { className: 'dc-section-label' }, '智能交互'), h('div', { className: 'dc-settings-group' },
            h('button', { type: 'button', className: 'dc-setting-row', onClick: () => go('voiceSettings') }, h('div', { className: 'dc-setting-icon' }, I('mic', 16)), h('div', { className: 'dc-setting-text' }, '语音输入', h('div', { className: 'dc-setting-sub' }, '按住说话 · 中文（普通话）')), h(Badge, { tone: voiceEnabled ? 'success' : '' }, voiceEnabled ? '已开启' : '已关闭'), I('chevron', 15)),
            h('button', { type: 'button', className: 'dc-setting-row', onClick: () => go('voiceSettings') }, h('div', { className: 'dc-setting-icon' }, I('cloud', 16)), h('div', { className: 'dc-setting-text' }, 'TTS 模型服务', h('div', { className: 'dc-setting-sub' }, tts.connected ? `${TTS_PROVIDERS[tts.provider].name} · 服务已连接` : tts.saved ? `${TTS_PROVIDERS[tts.provider].name} · 配置已保存` : '配置云厂商语音合成服务')), h(Badge, { tone: tts.connected ? 'success' : tts.saved ? 'brand' : '' }, tts.connected ? '已连接' : tts.saved ? '已保存' : '未配置'), I('chevron', 15))),
          h('div', { className: 'dc-section-label' }, t('privacy')), h('div', { className: 'dc-settings-group' }, pref('private', 'eye', '锁屏隐藏内容', '通知仅显示会话状态'), h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-icon' }, I('globe', 16)), h('div', { className: 'dc-setting-text' }, t('server'), h('div', { className: 'dc-setting-sub' }, 'connect.internal.example.com')), I('chevron', 15)), h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-icon' }, I('key', 16)), h('div', { className: 'dc-setting-text' }, '设备密钥', h('div', { className: 'dc-setting-sub' }, '上次轮换：2026/10/12')), I('chevron', 15))),
          h(Button, { style: { width: '100%' }, onClick: () => notify('诊断信息已生成，仅供本地查看') }, '诊断与帮助'), h('div', { style: { textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: 9, marginTop: 15 } }, 'DSH Connect for iOS · v1.0.0 Prototype'));
      }
      return h('div', { className: 'dc-phone' }, h(PhoneStatus), h('div', { className: 'dc-phone-body' }, body), ['chat', 'tasks', 'devices', 'profile'].includes(screen) && h(MobileNav, { t, page: screen, go, count: pendingCount }),
        drawerOpen && h(SessionDrawer, { sessions, selected, currentDevice, currentWorkspace, expandedWorkspace, sessionLimit, deviceMenu,
          onToggleDevice: () => setDeviceMenu(v => !v),
          onDevice: device => { setCurrentDevice(device.name); setCurrentWorkspace(device.workspaces[0]); setExpandedWorkspace(device.workspaces[0]); setSessionLimit(5); setDeviceMenu(false); notify(`已切换到 ${device.name}，请选择工作区或会话`); },
          onWorkspace: name => { setCurrentWorkspace(name); setExpandedWorkspace(expandedWorkspace === name ? '' : name); setSessionLimit(5); setDeviceMenu(false); },
          onMore: name => { setCurrentWorkspace(name); setExpandedWorkspace(name); setSessionLimit(Number.MAX_SAFE_INTEGER); },
          onCollapse: () => setSessionLimit(5),
          onNew: name => { setCurrentWorkspace(name); setExpandedWorkspace(name); setSessionLimit(5); go('new'); },
          onOpen: openSession,
          onClose: () => { setDrawerOpen(false); setDeviceMenu(false); } }),
        sheet === 'approval' && h(PhoneSheet, { title: '使用 Face ID 确认', copy: '你正在允许 MacBook Pro 执行一次集成测试。此授权不会应用到其他命令。', confirmText: '验证并允许', onClose: () => setSheet(null), onConfirm: () => { setSheet(null); setApprovalState('allowed'); notify('已允许本次操作'); go('tasks'); } }),
        sheet === 'revoke' && h(PhoneSheet, { title: '解除这台设备的配对？', copy: '解除后将阻止新的远程指令。桌面上的现有会话和正在运行的任务不会被删除。', icon: 'logout', confirmText: '确认解除', danger: true, onClose: () => setSheet(null), onConfirm: () => { setSheet(null); notify('设备配对已解除'); go('devices'); } }));
    }

    function MobileShowcase(props) {
      const guide = [['chat', 'chat', '会话与侧边栏', '恢复聊天并切换设备与工作区'], ['approval', 'shield', '远程审批', '核对命令并允许一次'], ['devices', 'monitor', '设备管理', '在线状态与工作区权限'], ['profile', 'user', '语音与设置', '语音服务、通知与隐私']];
      const flows = [['接收通知', '任务完成或需要审批'], ['核对上下文', '设备、工作区与工具参数'], ['安全推进', '发送指令或允许一次'], ['断线恢复', '按会话游标补齐事件']];
      const guideItems = guide.map(([id, icon, title, sub], i) =>
        h('button', { type: 'button', key: id, className: `dc-guide-item ${props.screen === id ? 'dc-on' : ''}`, onClick: () => props.setScreen(id) },
          h('span', { className: 'dc-num' }, String(i + 1).padStart(2, '0')),
          h('div', null, h('div', { style: { fontSize: 12, fontWeight: 650 } }, title), h('div', { style: { fontSize: 9, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 } }, sub)),
          h('span', { style: { marginLeft: 'auto' } }, I(icon, 15))));
      const flowItems = flows.map(([title, copy], i) =>
        h('div', { className: 'dc-flow', key: title },
          h('div', { className: 'dc-flow-line' }, h('div', { className: 'dc-flow-dot' }, i + 1)),
          h('div', null, h('div', { className: 'dc-flow-title' }, title), h('div', { className: 'dc-flow-copy' }, copy))));
      return h('div', { className: 'dc-mobile-stage' },
        h('div', { className: 'dc-phone-wrap' }, h(MobileApp, props)),
        h('aside', { className: 'dc-guide' },
          h('div', { className: 'dc-guide-card' },
            h('div', { className: 'dc-guide-kicker' }, 'Mobile experience'),
            h('div', { className: 'dc-guide-title' }, '离开电脑，任务仍在推进'),
            h('div', { className: 'dc-guide-copy' }, '390 pt 移动端高保真原型。点击页面中的会话、按钮和底部导航，体验完整控制链路。'),
            h('div', { className: 'dc-guide-list' }, ...guideItems)),
          h('div', { className: 'dc-guide-card' }, h('div', { className: 'dc-guide-kicker' }, 'Core journey'), ...flowItems)));
    }

    const ADMIN_SESSIONS = [
      { title: '设计 DSH Connect 高保真原型', id: 'sess_8fa2', device: 'MacBook Pro', user: '李伟', status: 'active', time: '刚刚' },
      { title: '修复 WebSocket 断线重连', id: 'sess_72bc', device: 'MacBook Pro', user: '陈晨', status: 'pending', time: '2 分钟前' },
      { title: '实现会话事件协议', id: 'sess_31de', device: 'Mac Studio', user: '李伟', status: 'finished', time: '18:26' },
      { title: '补充移动端断网测试', id: 'sess_19a8', device: 'Mac Studio', user: '王敏', status: 'error', time: '17:42' },
    ];
    function Metric({ icon, label, value, delta, down }) {
      return h('div', { className: 'dc-metric' }, h('div', { className: 'dc-metric-top' }, h('span', null, label), h('div', { className: 'dc-metric-icon' }, I(icon, 16))), h('div', { className: 'dc-metric-value' }, value), h('div', { className: `dc-metric-delta ${down ? 'dc-down' : ''}` }, delta));
    }
    function StatusBadge({ status, t }) { const s = STATUS[status] || STATUS.finished; return h(Badge, { tone: s[1] }, status === 'active' ? t('active') : s[0]); }
    function SessionsTable({ t, compact, notify }) {
      return h('div', { className: 'dc-table-wrap' }, h('table', { className: 'dc-table' }, h('thead', null, h('tr', null, h('th', null, '会话'), h('th', null, t('device')), h('th', null, t('operator')), h('th', null, t('status')), h('th', null, t('time')), h('th'))), h('tbody', null, ...ADMIN_SESSIONS.slice(0, compact ? 4 : ADMIN_SESSIONS.length).map(s => h('tr', { key: s.id }, h('td', null, h('div', { className: 'dc-cell-title' }, s.title), h('div', { className: 'dc-cell-sub' }, s.id)), h('td', null, s.device), h('td', null, s.user), h('td', null, h(StatusBadge, { status: s.status, t })), h('td', null, s.time), h('td', null, h('button', { type: 'button', className: 'dc-row-action', onClick: () => notify(`已打开 ${s.id} 的运行详情`) }, '详情')))))));
    }
    function Overview({ t, notify, setSection }) {
      const bars = [42, 68, 52, 86, 74, 112, 96].map((height, i) =>
        h('div', { className: `dc-bar-group ${i === 5 ? 'dc-on' : ''}`, key: i },
          h('div', { className: 'dc-bar', style: { height } }),
          h('div', { className: 'dc-bar-label' }, ['周三', '周四', '周五', '周六', '周日', '周一', '今天'][i])));
      const approvals = [['运行集成测试', '陈晨 · 高风险', 'command'], ['读取工作区文件', '王敏 · 中风险', 'eye'], ['安装项目依赖', '李伟 · 中风险', 'plus']].map(([title, sub, icon]) =>
        h('div', { className: 'dc-quick-item', key: title },
          h('div', { className: 'dc-activity-dot' }, I(icon, 14)),
          h('div', { className: 'dc-quick-copy' }, h('div', { className: 'dc-quick-title' }, title), h('div', { className: 'dc-quick-sub' }, sub)),
          h('button', { type: 'button', className: 'dc-row-action', onClick: () => setSection('approvals') }, '处理')));
      const activities = [['陈晨配对了新的 iPhone', '8 分钟前', 'phone'], ['Mac Studio 恢复在线', '26 分钟前', 'monitor'], ['王敏取消了异常任务', '42 分钟前', 'stop'], ['访问策略已由管理员更新', '1 小时前', 'lock']].map(([title, time, icon]) =>
        h('div', { className: 'dc-activity-item', key: title },
          h('div', { className: 'dc-activity-dot' }, I(icon, 14)),
          h('div', null, h('div', { className: 'dc-activity-title' }, title), h('div', { className: 'dc-activity-time' }, time))));
      return h(React.Fragment, null,
        h('div', { className: 'dc-page-head' },
          h('div', null, h('div', { className: 'dc-page-title' }, '晚上好，李伟'), h('div', { className: 'dc-page-copy' }, '所有核心服务运行正常，当前有 1 个高风险审批等待处理。')),
          h(Button, { icon: 'refresh', onClick: () => notify('运行状态已刷新') }, '刷新状态')),
        h('div', { className: 'dc-metrics' },
          h(Metric, { icon: 'monitor', label: t('activeDevices'), value: '8 / 10', delta: '较昨日 +1' }),
          h(Metric, { icon: 'activity', label: '活跃会话', value: '12', delta: '当前 5 人正在控制' }),
          h(Metric, { icon: 'send', label: t('todayCommands'), value: '286', delta: '较昨日 +18.2%' }),
          h(Metric, { icon: 'shield', label: t('pendingApprovals'), value: '3', delta: '1 个高风险', down: true })),
        h('div', { className: 'dc-grid-main' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 } },
            h('section', { className: 'dc-panel' },
              h('div', { className: 'dc-panel-head' }, h('div', { className: 'dc-panel-title' }, t('weekly')), h(Badge, { tone: 'success' }, '+18.2%')),
              h('div', { className: 'dc-chart' }, ...bars)),
            h('section', { className: 'dc-panel' },
              h('div', { className: 'dc-panel-head' }, h('div', { className: 'dc-panel-title' }, t('live')), h('button', { type: 'button', className: 'dc-panel-link', onClick: () => setSection('running') }, t('more'))),
              h(SessionsTable, { t, compact: true, notify }))),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
            h('section', { className: 'dc-panel' },
              h('div', { className: 'dc-panel-head' }, h('div', { className: 'dc-panel-title' }, '待处理审批'), h(Badge, { tone: 'warn' }, '3')),
              h('div', { className: 'dc-quick' }, ...approvals)),
            h('section', { className: 'dc-panel' },
              h('div', { className: 'dc-panel-head' }, h('div', { className: 'dc-panel-title' }, t('recent'))),
              h('div', { className: 'dc-activity' }, ...activities)))));
    }
    function UsersPage({ notify }) {
      const users = [['李伟', 'liwei@example.com', 'Owner', '2 台手机', '在线'], ['陈晨', 'chen@example.com', 'Member', '1 台手机', '在线'], ['王敏', 'min@example.com', 'Member', '1 台手机', '离线'], ['周琪', 'qi@example.com', 'Auditor', '无设备', '离线']];
      return h(React.Fragment, null, h('div', { className: 'dc-page-head' }, h('div', null, h('div', { className: 'dc-page-title' }, '用户与角色'), h('div', { className: 'dc-page-copy' }, '管理成员身份、移动设备和组织级角色。')), h(Button, { kind: 'primary', icon: 'plus', onClick: () => notify('邀请链接已创建，有效期 30 分钟') }, '邀请用户')),
        h('div', { className: 'dc-filterbar' }, h(Search, { value: '', onChange: () => {}, placeholder: '搜索姓名或邮箱' }), h('div', { className: 'dc-chips' }, h('button', { className: 'dc-chip dc-on', type: 'button' }, '全部成员 12'), h('button', { className: 'dc-chip', type: 'button' }, '在线 8'))),
        h('section', { className: 'dc-panel' }, h('div', { className: 'dc-table-wrap' }, h('table', { className: 'dc-table' }, h('thead', null, h('tr', null, ...['成员', '角色', '移动设备', '授权桌面', '状态', ''].map(x => h('th', { key: x }, x)))), h('tbody', null, ...users.map(([name, email, role, phone, status], i) => h('tr', { key: email }, h('td', null, h('div', { className: 'dc-cell-user' }, h('div', { className: 'dc-mini-avatar' }, name.slice(0, 1)), h('div', null, h('div', { className: 'dc-cell-title' }, name), h('div', { className: 'dc-cell-sub' }, email)))), h('td', null, h(Badge, { tone: role === 'Owner' ? 'brand' : '' }, role)), h('td', null, phone), h('td', null, i === 0 ? '全部 10 台' : `${i + 1} 台`), h('td', null, h(Badge, { tone: status === '在线' ? 'success' : '' }, status)), h('td', null, h('button', { type: 'button', className: 'dc-row-action', onClick: () => notify(`已打开 ${name} 的授权详情`) }, '管理')))))))));
    }
    function DevicesPage({ notify }) {
      const [tab, setTab] = useState('desktop'); const [revoked, setRevoked] = useState(false);
      const rows = tab === 'desktop' ? [['MacBook Pro', 'Connector 1.0.0 · DSH 3.8.2', '李伟', '3 个工作区', '在线'], ['Mac Studio', 'Connector 1.0.0 · DSH 3.8.2', '陈晨', '2 个工作区', '在线'], ['Windows-Dev-04', 'Connector 0.9.8 · DSH 3.8.0', '王敏', '4 个工作区', '离线']] : [['李伟的 iPhone', 'iOS · App 1.0.0', '李伟', 'Face ID', '当前设备'], ['陈晨的 iPhone', 'iOS · App 1.0.0', '陈晨', 'Face ID', '在线'], ['Pixel 10', 'Android · App 1.0.0', '王敏', '设备锁屏', '离线']];
      return h(React.Fragment, null, h('div', { className: 'dc-page-head' }, h('div', null, h('div', { className: 'dc-page-title' }, '设备管理'), h('div', { className: 'dc-page-copy' }, '桌面 Connector 与手机设备分别授权、独立吊销。')), h(Button, { kind: 'primary', icon: 'plus', onClick: () => notify('桌面配对码：DC-8F2K-91PQ · 10 分钟内有效') }, '添加桌面')),
        h('div', { className: 'dc-filterbar' }, h('div', { className: 'dc-chips' }, h('button', { type: 'button', className: `dc-chip ${tab === 'desktop' ? 'dc-on' : ''}`, onClick: () => setTab('desktop') }, '桌面 Connector'), h('button', { type: 'button', className: `dc-chip ${tab === 'mobile' ? 'dc-on' : ''}`, onClick: () => setTab('mobile') }, '手机设备')), h(Search, { value: '', onChange: () => {}, placeholder: '搜索设备' })),
        h('section', { className: 'dc-panel' }, h('div', { className: 'dc-table-wrap' }, h('table', { className: 'dc-table' }, h('thead', null, h('tr', null, ...['设备', '所属用户', tab === 'desktop' ? '工作区' : '安全验证', '状态', '操作'].map(x => h('th', { key: x }, x)))), h('tbody', null, ...rows.map(([name, meta, user, scope, status], i) => h('tr', { key: name }, h('td', null, h('div', { className: 'dc-cell-user' }, h('div', { className: 'dc-mini-avatar' }, I(tab === 'desktop' ? 'monitor' : 'phone', 14)), h('div', null, h('div', { className: 'dc-cell-title' }, name), h('div', { className: 'dc-cell-sub' }, meta)))), h('td', null, user), h('td', null, scope), h('td', null, h(Badge, { tone: revoked && i === 2 ? 'error' : status === '离线' ? '' : 'success' }, revoked && i === 2 ? '已吊销' : status)), h('td', null, h('button', { type: 'button', className: 'dc-row-action', onClick: () => notify(`已打开 ${name} 详情`) }, '详情'), h('button', { type: 'button', className: 'dc-row-action dc-danger', disabled: revoked && i === 2, onClick: () => { if (i === 2) setRevoked(true); notify(`${name} 的新命令权限已吊销`); } }, '吊销')))))))));
    }
    function PoliciesPage({ notify }) {
      const [selected, setSelected] = useState(0); const [checks, setChecks] = useState({ read: true, prompt: true, cancel: true, approve: false });
      const policies = [['移动端研发组', '8 名成员 · 3 台桌面'], ['架构组只读访问', '3 名成员 · 6 台桌面'], ['外部协作者', '2 名成员 · 1 个工作区']];
      return h(React.Fragment, null, h('div', { className: 'dc-page-head' }, h('div', null, h('div', { className: 'dc-page-title' }, '访问策略'), h('div', { className: 'dc-page-copy' }, '按“成员—设备—工作区—动作”配置，默认拒绝未授权访问。')), h(Button, { kind: 'primary', icon: 'plus', onClick: () => notify('已创建空白访问策略') }, '新建策略')),
        h('div', { className: 'dc-policy-grid' }, h('div', { className: 'dc-panel dc-policy-list' }, ...policies.map(([name, sub], i) => h('button', { type: 'button', key: name, className: `dc-policy-item ${selected === i ? 'dc-on' : ''}`, onClick: () => setSelected(i) }, h('div', { className: 'dc-policy-name' }, name), h('div', { className: 'dc-policy-desc' }, sub)))),
          h('section', { className: 'dc-panel' }, h('div', { className: 'dc-panel-head' }, h('div', null, h('div', { className: 'dc-panel-title' }, policies[selected][0]), h('div', { className: 'dc-cell-sub' }, '策略 ID · policy_mobile_team')), h(Button, { onClick: () => notify('访问策略已保存并即时生效') }, '保存策略')),
            h('div', { className: 'dc-panel-pad' }, h('div', { className: 'dc-form-row' }, h('div', { className: 'dc-field' }, h('label', null, '授权桌面'), h('select', { className: 'dc-select' }, h('option', null, 'MacBook Pro、Mac Studio'))), h('div', { className: 'dc-field' }, h('label', null, '授权工作区'), h('select', { className: 'dc-select' }, h('option', null, 'dsh-connect、server')))),
              h('div', { className: 'dc-section-label' }, '操作权限'), h('div', { className: 'dc-settings-group' }, ...[['read', 'eye', '查看会话', '读取会话元数据、历史消息与运行状态'], ['prompt', 'send', '发送提示词', '允许排队发送和立即引导'], ['cancel', 'stop', '取消执行', '取消授权会话中的当前 Turn'], ['approve', 'shield', '远程审批', '允许对高风险操作作出一次性决定']].map(([key, icon, title, sub]) => h('div', { className: 'dc-setting-row', key: key }, h('div', { className: 'dc-setting-icon' }, I(icon, 16)), h('div', { className: 'dc-setting-text' }, title, h('div', { className: 'dc-setting-sub' }, sub)), h(Toggle, { value: checks[key], label: title, onChange: v => setChecks(c => ({ ...c, [key]: v })) })))),
              h('div', { className: 'dc-warning' }, '远程审批权限独立于“发送提示词”。高风险操作仍需在 App 中完成生物识别。')))));
    }
    function ApprovalsPage({ notify }) {
      const [policy, setPolicy] = useState({ remote: true, bio: true, desktop: true });
      return h(React.Fragment, null, h('div', { className: 'dc-page-head' }, h('div', null, h('div', { className: 'dc-page-title' }, '审批与策略'), h('div', { className: 'dc-page-copy' }, '远程审批仅允许一次授权，超时或异常时默认不批准。'))),
        h('div', { className: 'dc-grid-main' }, h('section', { className: 'dc-panel' }, h('div', { className: 'dc-panel-head' }, h('div', { className: 'dc-panel-title' }, '待处理请求'), h(Badge, { tone: 'warn' }, '3 项')), h('div', { className: 'dc-table-wrap' }, h('table', { className: 'dc-table' }, h('thead', null, h('tr', null, ...['操作', '会话', '发起人', '风险', '剩余时间', ''].map(x => h('th', { key: x }, x)))), h('tbody', null, ...[['运行集成测试', '修复 WebSocket 断线重连', '陈晨', '高', '04:38'], ['读取环境配置', '实现会话事件协议', '王敏', '中', '09:12'], ['安装项目依赖', '补充移动端断网测试', '李伟', '中', '12:46']].map(([op, session, user, risk, time]) => h('tr', { key: op }, h('td', null, h('div', { className: 'dc-cell-title' }, op), h('div', { className: 'dc-cell-sub' }, 'bash · MacBook Pro')), h('td', null, session), h('td', null, user), h('td', null, h(Badge, { tone: risk === '高' ? 'error' : 'warn' }, `${risk}风险`)), h('td', null, time), h('td', null, h('button', { type: 'button', className: 'dc-row-action', onClick: () => notify(`已打开“${op}”审批详情`) }, '核对')))))))),
          h('section', { className: 'dc-panel' }, h('div', { className: 'dc-panel-head' }, h('div', { className: 'dc-panel-title' }, '全局审批策略')), h('div', { className: 'dc-panel-pad' }, ...[['remote', '允许远程审批', '仅在授权的工作区生效'], ['bio', '强制生物识别', '高风险操作必须再次验证'], ['desktop', '保留桌面审批链', '移动端不处理时交给桌面端']].map(([key, title, sub]) => h('div', { className: 'dc-setting-row', key: key }, h('div', { className: 'dc-setting-text' }, title, h('div', { className: 'dc-setting-sub' }, sub)), h(Toggle, { value: policy[key], label: title, onChange: v => setPolicy(p => ({ ...p, [key]: v })) }))), h('div', { className: 'dc-field', style: { marginTop: 15 } }, h('label', null, '审批有效期'), h('select', { className: 'dc-select' }, h('option', null, '15 分钟'))), h(Button, { kind: 'primary', style: { width: '100%' }, onClick: () => notify('审批策略已保存，变更已记录审计') }, '保存策略')))));
    }
    function AuditPage({ notify }) {
      const [query, setQuery] = useState('');
      const rows = [['22:06:42', '李伟', '允许一次审批', '修复 WebSocket 断线重连', '成功'], ['22:04:18', '陈晨', '发送提示词', '设计移动端异常状态', '成功'], ['21:58:07', '王敏', '吊销手机设备', 'Pixel 8', '成功'], ['21:46:31', '外部协作者', '发送提示词', 'server / 生产配置', '已拒绝'], ['21:32:16', '系统管理员', '更新访问策略', 'policy_mobile_team', '成功']];
      const visible = rows.filter(r => r.join('').includes(query));
      return h(React.Fragment, null, h('div', { className: 'dc-page-head' }, h('div', null, h('div', { className: 'dc-page-title' }, '审计日志'), h('div', { className: 'dc-page-copy' }, '记录身份、设备、目标资源、请求 ID 与操作结果。')), h(Button, { icon: 'export', onClick: () => notify('已导出当前筛选范围的 CSV 日志') }, '导出日志')),
        h('div', { className: 'dc-filterbar' }, h(Search, { value: query, onChange: setQuery, placeholder: '搜索用户、会话或操作' }), h('div', { className: 'dc-chips' }, h('button', { type: 'button', className: 'dc-chip dc-on' }, '全部事件'), h('button', { type: 'button', className: 'dc-chip' }, '高风险'), h('button', { type: 'button', className: 'dc-chip' }, '已拒绝'))),
        h('section', { className: 'dc-panel' }, h('div', { className: 'dc-table-wrap' }, h('table', { className: 'dc-table' }, h('thead', null, h('tr', null, ...['时间', '操作者', '操作', '目标资源', '结果', '请求 ID'].map(x => h('th', { key: x }, x)))), h('tbody', null, ...visible.map((r, i) => h('tr', { key: r[0] }, ...r.map((cell, j) => h('td', { key: j }, j === 4 ? h(Badge, { tone: cell === '成功' ? 'success' : 'error' }, cell) : cell)), h('td', null, `req_${(928410 - i * 317).toString(16)}`))))))), visible.length === 0 && h('div', { className: 'dc-panel-pad' }, '没有匹配的审计记录'));
    }
    function SettingsPage({ notify }) {
      const [values, setValues] = useState({ lock: true, audit: true, push: true });
      return h(React.Fragment, null, h('div', { className: 'dc-page-head' }, h('div', null, h('div', { className: 'dc-page-title' }, '系统设置'), h('div', { className: 'dc-page-copy' }, '配置服务访问、安全基线、通知和隐私策略。')), h(Button, { kind: 'primary', onClick: () => notify('系统设置已保存') }, '保存更改')),
        h('div', { className: 'dc-settings-grid' }, h('section', { className: 'dc-panel dc-panel-pad' }, h('div', { className: 'dc-panel-title', style: { marginBottom: 16 } }, '服务与访问'), h('div', { className: 'dc-field' }, h('label', null, 'Server 外部地址'), h('input', { className: 'dc-input', defaultValue: 'https://connect.internal.example.com' })), h('div', { className: 'dc-form-row' }, h('div', { className: 'dc-field' }, h('label', null, '配对码有效期'), h('select', { className: 'dc-select', defaultValue: '10' }, h('option', { value: '10' }, '10 分钟'))), h('div', { className: 'dc-field' }, h('label', null, 'Access Token'), h('select', { className: 'dc-select' }, h('option', null, '15 分钟')))), h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-text' }, '锁屏隐藏通知正文', h('div', { className: 'dc-setting-sub' }, '仅显示任务状态和设备名称')), h(Toggle, { value: values.lock, label: '锁屏隐藏通知正文', onChange: v => setValues(x => ({ ...x, lock: v })) }))),
          h('section', { className: 'dc-panel dc-panel-pad' }, h('div', { className: 'dc-panel-title', style: { marginBottom: 16 } }, '通知与审计'), h('div', { className: 'dc-field' }, h('label', null, 'APNs / FCM'), h('input', { className: 'dc-input', value: '生产环境 · 凭据有效', readOnly: true })), h('div', { className: 'dc-field' }, h('label', null, '审计日志保留'), h('select', { className: 'dc-select' }, h('option', null, '180 天'))), h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-text' }, '任务推送', h('div', { className: 'dc-setting-sub' }, '完成、失败与审批通知')), h(Toggle, { value: values.push, label: '任务推送', onChange: v => setValues(x => ({ ...x, push: v })) })), h('div', { className: 'dc-setting-row' }, h('div', { className: 'dc-setting-text' }, '高风险操作审计', h('div', { className: 'dc-setting-sub' }, '强制开启，不可关闭')), h(Toggle, { value: true, label: '高风险操作审计', onChange: () => notify('高风险审计为强制安全策略') }))),
          h('section', { className: 'dc-panel dc-panel-pad', style: { gridColumn: '1 / -1' } }, h('div', { className: 'dc-panel-title', style: { marginBottom: 10 } }, '运行环境'), h('div', { className: 'dc-form-row' }, h('div', { className: 'dc-info-card' }, h('div', { className: 'dc-info-row' }, h('span', null, 'Go Server'), h('span', null, 'v1.0.0 · 运行正常')), h('div', { className: 'dc-info-row' }, h('span', null, 'PostgreSQL'), h('span', null, '16 · 已连接'))), h('div', { className: 'dc-info-card' }, h('div', { className: 'dc-info-row' }, h('span', null, 'Connector 兼容版本'), h('span', null, '≥ 1.0.0')), h('div', { className: 'dc-info-row' }, h('span', null, '最近配置更新'), h('span', null, '2026/10/27 21:30')))))));
    }
    function AdminApp({ t, notify }) {
      const [section, setSection] = useState('overview');
      const nav = [['overview', 'home', t('overview')], ['users', 'users', t('users')], ['devices', 'monitor', t('devices')], ['policies', 'lock', t('policies')], ['running', 'activity', t('running')], ['approvals', 'shield', t('approvals')], ['audit', 'list', t('audit')], ['settings', 'settings', t('settings')]];
      const title = (nav.find(x => x[0] === section) || nav[0])[2];
      let content;
      if (section === 'overview') content = h(Overview, { t, notify, setSection });
      else if (section === 'users') content = h(UsersPage, { notify });
      else if (section === 'devices') content = h(DevicesPage, { notify });
      else if (section === 'policies') content = h(PoliciesPage, { notify });
      else if (section === 'approvals') content = h(ApprovalsPage, { notify });
      else if (section === 'audit') content = h(AuditPage, { notify });
      else if (section === 'settings') content = h(SettingsPage, { notify });
      else content = h(React.Fragment, null,
        h('div', { className: 'dc-page-head' },
          h('div', null, h('div', { className: 'dc-page-title' }, '运行与会话'), h('div', { className: 'dc-page-copy' }, '仅展示运行元数据；会话正文访问需要独立敏感权限。')),
          h(Button, { icon: 'refresh', onClick: () => notify('会话状态已同步') }, '同步状态')),
        h('div', { className: 'dc-filterbar' },
          h(Search, { value: '', onChange: () => {}, placeholder: '搜索会话 ID 或标题' }),
          h('div', { className: 'dc-chips' }, h('button', { className: 'dc-chip dc-on', type: 'button' }, '全部'), h('button', { className: 'dc-chip', type: 'button' }, '运行中'), h('button', { className: 'dc-chip', type: 'button' }, '异常'))),
        h('section', { className: 'dc-panel' }, h(SessionsTable, { t, notify })));
      return h('div', { className: 'dc-admin-wrap' }, h('div', { className: 'dc-admin' }, h('aside', { className: 'dc-admin-side' }, h('div', { className: 'dc-admin-brand' }, h('div', { className: 'dc-brand-mark' }, h(Logo, { size: 25 })), h('div', null, h('div', { className: 'dc-admin-brand-name' }, 'DSH Connect'), h('div', { className: 'dc-admin-brand-sub' }, 'CONTROL CENTER'))), h('nav', { className: 'dc-admin-nav' }, ...nav.map(([id, icon, label]) => h('button', { type: 'button', key: id, className: section === id ? 'dc-on' : '', onClick: () => setSection(id) }, I(icon, 17), h('span', null, label), id === 'approvals' && h('span', { className: 'dc-nav-count' }, '3')))), h('div', { className: 'dc-admin-user' }, h(Avatar, null, 'LW'), h('div', null, h('div', { className: 'dc-admin-user-name' }, '李伟'), h('div', { className: 'dc-admin-user-role' }, 'System Owner')), h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary)' } }, I('more', 15)))),
        h('main', { className: 'dc-admin-main' }, h('header', { className: 'dc-admin-head' }, h('div', { className: 'dc-admin-title' }, title), h(Search, { value: '', onChange: () => {}, placeholder: '全局搜索  ⌘ K' }), h('div', { className: 'dc-env' }, h('span', { className: 'dc-demo-dot' }), 'Production'), h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => notify('你有 3 条未读系统通知'), 'aria-label': '通知' }, I('bell', 16))), h('div', { className: 'dc-admin-content' }, content))));
    }

    function Prototype({ t, locale }) {
      const [surface, setSurface] = useState('mobile');
      const [screen, setScreen] = useState('chat');
      const [toast, setToast] = useState('');
      const [, setLocaleRev] = useState(0);
      const timer = useRef(null);
      useEffect(() => locale.subscribe(() => setLocaleRev(x => x + 1)), [locale]);
      useEffect(() => () => clearTimeout(timer.current), []);
      const notify = text => { setToast(text); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 2400); };
      return h('div', { className: 'dc-root' },
        h('header', { className: 'dc-topbar' }, h('div', { className: 'dc-brand' }, h('div', { className: 'dc-brand-mark' }, h(Logo, { size: 26 })), h('div', null, h('div', { className: 'dc-brand-title' }, t('appName')), h('div', { className: 'dc-brand-sub' }, t('prototype')))),
          h('div', { className: 'dc-switch', role: 'tablist' }, h('button', { type: 'button', role: 'tab', 'aria-selected': surface === 'mobile', className: surface === 'mobile' ? 'dc-on' : '', onClick: () => setSurface('mobile') }, I('phone', 15), t('mobile')), h('button', { type: 'button', role: 'tab', 'aria-selected': surface === 'admin', className: surface === 'admin' ? 'dc-on' : '', onClick: () => setSurface('admin') }, I('monitor', 15), t('admin'))),
          h('div', { className: 'dc-demo' }, h('span', { className: 'dc-demo-dot' }), t('demo')), h('button', { type: 'button', className: 'dc-icon-btn', onClick: () => notify('点击界面元素即可体验交互流程'), 'aria-label': '帮助' }, I('more', 17))),
        surface === 'mobile' ? h(MobileShowcase, { t, notify, screen, setScreen }) : h(AdminApp, { t, notify }),
        toast && h('div', { className: 'dc-toast', role: 'status' }, I('check', 16), toast));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('dsh-connect-prototype', 'zh', DICTS.zh));
        ctx.effect(() => ctx.locale.register('dsh-connect-prototype', 'en', DICTS.en));
        styles.insert(CSS);
        const t = ctx.locale.bind('dsh-connect-prototype');
        function PanelIcon({ size = 20 }) { return h(Logo, { size }); }
        function Root() { return h(Prototype, { t, locale: ctx.locale }); }
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 6, label: () => t('appName') }, PanelIcon));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Root));
      },
    };
  },
});
