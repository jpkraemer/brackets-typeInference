# Type Inference

Type inference is a Brackets plugin that tries to bring type information back to Javascript. It leverages runtime information as well as static analysis to determine the types of function arguments. This information is used to automatically keep documentation up to date, warn about inconsistencies and to improve Bracket's autocompletion. 

## Installation 

Make sure you have Node.js and Brackets installed. 

```
brew install node
brew cask install brackets
```

In some separate folder to hold your source files, check out some npm modules we needed to modify. This is assuming you keep these projects in `~/Documents/Source`. 

```
cd ~/Documents/Source
git clone https://github.com/jpkraemer/fondue.git
cd fondue 
git checkout supportForTypeInference
npm install 
npm link
cd ..
git clone https://github.com/adobe-research/node-theseus.git
cd node-theseus
npm install
npm link fondue
npm link
```

Download a recent version of esprima.js from 
```
https://cdn.rawgit.com/jquery/esprima/2.7.2/esprima.js
```

In the fondue directory, find the node_modules folder and change the esprima.js in `./esprima`, `./falafel/node_modules/esprima`, and `./falafel-map/node_modules/esprima`.
Yes, it's a hack. We did mention it's a research prototype, right? :)  

Install the actual plugins required. 

```
cd ~/Library/Application\ Support/Brackets/extensions/user
git clone https://github.com/jpkraemer/brackets-typeInference.git
cd brackets-typeInference 
git checkout -b origin/unitTestGeneration 
cd src/node
npm install 
cd ../../..
git clone https://github.com/adobe-research/theseus.git
cd theseus
npm install
npm link fondue
```

Next, change the package.json of theseus to accept fondue 0.5.x instead of 0.6.x. 

## Setup your sample project

We highly recommend not using a production project with Vesta. In a project you open with Vesta you need to have a folder brackets_spec. 


