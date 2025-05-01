### 配置命令

```package.json
    {
          "mergeMain": "node ./node_modules/mergeintoorigin --repoName=xxxx --repoUrl=git@xxxx.com/xxxx.git --baseBranch=main --targetFolder=xxx/xxxx --sourceFolder=dist --buildCmd='npm run build'"

    }

```

##### --repoUrl=git@xxx.xxx.com/xxx.git 主项目 git 地址

##### --baseBranch=main 想要合并到主项的 main 分支

##### --targetFolder=xx/xxxx 主项目的 xx/xxxx 文件夹中

##### --sourceFolder=dist 【本项目】子项目的 dist 文件夹（一般打包后都是叫 dist 文件夹，有的叫 build 文件夹请自行更换文件夹名称）

##### --buildCmd='npm run build' 【本项目】子项目的打包命令理论上都是自己项目中的 npm run build 如果有特殊请自行更改自己项目中的打包命令 用于生成 dist 文件夹
